import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { iso, addDays, MONTH_NAMES, LABOR_TYPES, effectiveLabor } from '../utils.js';
import MeetingNotesEditor from './MeetingNotesEditor.jsx';
import FlowbiteDateInput from './FlowbiteDateInput.jsx';
import TaskLabel from './TaskLabel.jsx';
import DayDetailPanel from './DayDetailPanel.jsx';
import CreateMeetingModal from './CreateMeetingModal.jsx';
import QuickTypeDropdown from './QuickTypeDropdown.jsx';
import ItemActionsMenu from './ItemActionsMenu.jsx';
import EditEventModal from './EditEventModal.jsx';
import WeeklyMonthSummary from './WeeklyMonthSummary.jsx';
import { FileText, FolderKanban, Pencil, Trash2 } from 'lucide-react';

const DOW_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function getWeekDays(base) {
  const d = new Date(base);
  const dow = d.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + mondayOffset);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    days.push(day);
  }
  return days;
}

// Lista única del día: eventos, reuniones y tareas (hechas o no), con el orden manual guardado.
// Los elementos sin orden guardado van al final en el orden por defecto (eventos, reuniones, tareas).
function buildDayItems({ dateIso, events = [], meetings = [], todos = [], order = [] }) {
  // Outlook puede devolver varias reuniones con el mismo uid el mismo día (p. ej. una y su copia "Cancelado:"):
  // la clave debe ser única en la columna o React las confunde al reordenar
  const used = new Map();
  const uniqueKey = base => {
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
  const defaults = [
    ...events.map(data => ({ key: uniqueKey(`event-${data.id}`), type: 'event', data })),
    ...meetings.map(data => ({ key: uniqueKey(`meeting-${data.uid}`), type: 'meeting', data })),
    ...todos.map(data => ({ key: uniqueKey(`todo-${data.id}`), type: 'todo', data })),
  ];
  const position = new Map(order.map((key, i) => [key, i]));
  const items = [
    ...defaults.filter(item => position.has(item.key)).sort((a, b) => position.get(a.key) - position.get(b.key)),
    ...defaults.filter(item => !position.has(item.key)),
  ];
  // Las tareas que empiezan este día mantienen su orden real (sort_order, el del panel del día) dentro de
  // los huecos que ocupan; las continuaciones de tareas multi-día conservan la posición guardada.
  const isOwned = item => item.type === 'todo' && item.data.date === dateIso;
  const ownedTodos = defaults.filter(isOwned);
  let n = 0;
  return items.map(item => (isOwned(item) ? ownedTodos[n++] : item));
}

function removeTodoFromBuckets(buckets, todoId) {
  const next = {};
  Object.entries(buckets).forEach(([key, todos]) => {
    next[key] = todos.filter(todo => todo.id !== todoId);
  });
  return next;
}

// Posición de layout (sin las animaciones translate/scale en curso), en coordenadas de viewport
function layoutBox(node) {
  const parent = node.offsetParent;
  if (!parent) return node.getBoundingClientRect();
  const pr = parent.getBoundingClientRect();
  const top = pr.top + parent.clientTop - parent.scrollTop + node.offsetTop;
  return { top, bottom: top + node.offsetHeight };
}

// Elemento antes del que se insertaría lo arrastrado según la altura del puntero (null = al final).
// Se calcula sobre toda la columna para que los huecos entre tarjetas también cuenten.
function getBeforeKeyByPointer(container, clientY) {
  const nodes = container.querySelectorAll('[data-item-key]');
  for (const node of nodes) {
    const box = layoutBox(node);
    if (clientY < (box.top + box.bottom) / 2) return node.dataset.itemKey;
  }
  return null;
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Marcador de inserción: una sola línea (con punto) dibujada por CSS en el hueco entre tarjetas.
// Se posiciona con --drop-y para que se deslice entre huecos en lugar de saltar.
function placeDropMarker(body, beforeKey) {
  const items = [...body.querySelectorAll(':scope > [data-item-key]')];
  const bodyRect = body.getBoundingClientRect();
  const idx = beforeKey ? items.findIndex(el => el.dataset.itemKey === beforeKey) : items.length;
  const prev = items[idx - 1] && layoutBox(items[idx - 1]);
  const next = items[idx] && layoutBox(items[idx]);
  let y;
  if (prev && next) y = (prev.bottom + next.top) / 2;
  else if (next) y = next.top - 3;
  else if (prev) y = prev.bottom + 3;
  else y = bodyRect.top + 12;
  const offset = y - bodyRect.top + body.scrollTop;
  const wasVisible = body.hasAttribute('data-drop');
  body.style.setProperty('--drop-y', `${offset}px`);
  if (!wasVisible) {
    // aparece directamente en su sitio (sin deslizarse desde la posición anterior)
    body.getBoundingClientRect();
    body.setAttribute('data-drop', '');
  }
}

function hideDropMarkers(root, except = null) {
  root?.querySelectorAll('.wv-col-body[data-drop]').forEach(el => {
    if (el !== except) el.removeAttribute('data-drop');
  });
}

function shiftIso(dateIso, days) {
  const d = new Date(dateIso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return iso(d);
}

function daysBetween(fromIso, toIso) {
  return Math.round((new Date(toIso + 'T00:00:00') - new Date(fromIso + 'T00:00:00')) / 86400000);
}

function normalizedMeetingTitle(title) {
  return String(title || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function dedupeMeetingsForDay(meetings = []) {
  const seen = new Set();
  return meetings.filter(m => {
    const key = [
      m.date || '',
      normalizedMeetingTitle(m.title),
      m.allDay ? '1' : '0',
      m.startTime || '',
      m.endTime || '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// dayMode: muestra solo el día `date` (horas + columna del día) para el panel lateral de la vista mensual
export default function WeeklyView({ today, onReload, laborMap = {}, projects = [], resetSignal = 0, dayMode = false, date = null, refreshSignal = 0 }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState(() => iso(today));

  // El orbe "Hoy" del dock móvil incrementa resetSignal: volver a la semana actual
  useEffect(() => {
    if (resetSignal > 0) { setWeekOffset(0); setSelectedDate(iso(today)); }
  }, [resetSignal]);
  const [weekTodos, setWeekTodos] = useState({});
  const [weekMeetings, setWeekMeetings] = useState({});
  const [overdue, setOverdue] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [dropTarget, setDropTarget] = useState(null);
  const [dragKey, setDragKey] = useState(null);
  const [landedKey, setLandedKey] = useState(null);
  const rootRef = useRef(null);
  const dragInfoRef = useRef(null);
  const flipRectsRef = useRef(null);
  const [todoText, setTodoText] = useState('');
  const [todoDate, setTodoDate] = useState('');
  const [weekendOpen, setWeekendOpen] = useState(false);
  const [notesEditor, setNotesEditor] = useState(null);
  const [editingMeetingId, setEditingMeetingId] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [quickType, setQuickType] = useState('task');
  const [quickText, setQuickText] = useState('');
  const quickInputRef = useRef(null);
  const [weekEvents, setWeekEvents] = useState({});
  const [weekOrder, setWeekOrder] = useState({});
  const [monthEventDates, setMonthEventDates] = useState(() => new Set());
  const [monthHours, setMonthHours] = useState({});
  const [monthTick, setMonthTick] = useState(0);
  // Mientras se arrastra o se guarda un movimiento no se aplican recargas que pisen el estado optimista
  const draggingRef = useRef(false);
  const mutationRef = useRef(0);
  const isStale = seq => seq !== mutationRef.current;
  const todayIso = iso(today);
  const baseDate = dayMode && date ? new Date(date + 'T00:00:00') : new Date(today);
  if (!dayMode) baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  const weekDays = getWeekDays(baseDate);
  const weekFrom = iso(weekDays[0]);
  const weekTo = iso(weekDays[6]);
  // Si el día seleccionado no está en la semana visible, se usa el primero (o hoy)
  const selectedIso = dayMode && date ? date : selectedDate >= weekFrom && selectedDate <= weekTo
    ? selectedDate
    : (todayIso >= weekFrom && todayIso <= weekTo ? todayIso : weekFrom);

  const loadTodos = useCallback(async () => {
    const seq = mutationRef.current;
    const todos = await api.listTodos({ from: weekFrom, to: weekTo });
    if (isStale(seq)) return;
    const map = {};
    weekDays.forEach(d => { map[iso(d)] = []; });
    todos.forEach(t => {
      const start = t.date;
      const end = t.end_date || t.date;
      weekDays.forEach(d => {
        const dayIso = iso(d);
        if (dayIso >= start && dayIso <= end && map[dayIso] !== undefined) {
          map[dayIso].push({ ...t, _displayDate: dayIso });
        }
      });
    });
    setWeekTodos(map);
  }, [weekFrom, weekTo]);

  const loadMeetings = useCallback(async () => {
    try {
      const meetings = await api.listMeetings({ from: weekFrom, to: weekTo });
      const map = {};
      weekDays.forEach(d => { map[iso(d)] = []; });
      meetings.forEach(m => { if (map[m.date]) map[m.date].push(m); });
      Object.keys(map).forEach(dateKey => {
        map[dateKey] = dedupeMeetingsForDay(map[dateKey]);
      });
      setWeekMeetings(map);
    } catch { setWeekMeetings({}); }
  }, [weekFrom, weekTo]);

  const loadEvents = useCallback(async () => {
    const seq = mutationRef.current;
    try {
      const events = await api.listEvents({ from: weekFrom, to: weekTo });
      if (isStale(seq)) return;
      const map = {};
      events.forEach(ev => { (map[ev.date] ||= []).push(ev); });
      setWeekEvents(map);
    } catch { setWeekEvents({}); }
  }, [weekFrom, weekTo]);

  const loadOrder = useCallback(async () => {
    const seq = mutationRef.current;
    try {
      const rows = await api.listDayOrder(weekFrom, weekTo);
      if (isStale(seq)) return;
      const map = {};
      rows.forEach(r => { (map[r.date] ||= []).push(r.item_key); });
      setWeekOrder(map);
    } catch { setWeekOrder({}); }
  }, [weekFrom, weekTo]);

  const loadOverdue = useCallback(async () => {
    try { setOverdue(await api.overdueTodos(todayIso)); } catch { setOverdue([]); }
  }, [todayIso]);

  const loadUnassigned = useCallback(async () => {
    const seq = mutationRef.current;
    try {
      const rows = await api.unassignedTodos();
      if (!isStale(seq)) setUnassigned(rows);
    } catch { setUnassigned([]); }
  }, []);

  const reloadAll = useCallback(() => {
    loadTodos(); loadMeetings(); loadEvents(); loadOrder(); loadOverdue(); loadUnassigned(); onReload?.();
    setMonthTick(t => t + 1);
  }, [loadTodos, loadMeetings, loadEvents, loadOrder, loadOverdue, loadUnassigned, onReload]);

  // Resumen mensual: eventos y horas registradas del mes del día seleccionado
  const monthKey = selectedIso.slice(0, 7);
  useEffect(() => {
    if (dayMode) return undefined;
    const [y, m] = monthKey.split('-').map(Number);
    const from = `${monthKey}-01`;
    const to = `${monthKey}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    let alive = true;
    api.listEvents({ from, to }).then(events => {
      if (alive) setMonthEventDates(new Set((events || []).map(e => e.date)));
    }).catch(() => {});
    api.listWork({ from, to }).then(rows => {
      if (!alive) return;
      const map = {};
      (rows || []).forEach(w => { if (w?.date) map[w.date] = (map[w.date] || 0) + (Number(w.hours) || 0); });
      setMonthHours(map);
    }).catch(() => {});
    return () => { alive = false; };
  }, [monthKey, monthTick, dayMode]);

  const selectDay = useCallback((dayIso) => {
    const monday = d => getWeekDays(d)[0];
    const diff = monday(new Date(dayIso + 'T00:00:00')) - monday(today);
    setWeekOffset(Math.round(diff / (7 * 24 * 3600 * 1000)));
    setSelectedDate(dayIso);
  }, [today]);

  useEffect(() => { loadTodos(); loadMeetings(); loadEvents(); loadOrder(); loadOverdue(); loadUnassigned(); }, [loadTodos, loadMeetings, loadEvents, loadOrder, loadOverdue, loadUnassigned]);

  // El padre pidió recargar (p. ej. una tarea soltada desde el calendario mensual)
  useEffect(() => {
    if (refreshSignal > 0) { loadTodos(); loadOrder(); }
  }, [refreshSignal]);

  useEffect(() => {
    // Evita sondear la API mientras la pestaña está en segundo plano
    const poll = () => {
      if (document.hidden || draggingRef.current) return;
      loadTodos(); loadMeetings(); loadEvents(); loadOrder(); loadOverdue(); loadUnassigned();
    };
    const id = setInterval(poll, 5000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [loadTodos, loadMeetings, loadEvents, loadOrder, loadOverdue, loadUnassigned]);

  const QUICK_TYPES = [
    { key: 'task', icon: '✓', label: 'Tarea', placeholder: 'Nueva tarea…' },
    { key: 'event', icon: '📌', label: 'Evento', placeholder: 'Nuevo evento…' },
    { key: 'delivery', icon: '📦', label: 'Entrega', placeholder: 'Nueva entrega…' },
    { key: 'meeting', icon: '📅', label: 'Reunión', placeholder: 'Nueva reunión…' },
  ];

  const quickAdd = async (e, dateIso) => {
    e.preventDefault();
    const text = quickText.trim();
    if (!text) return;
    if (quickType === 'task') {
      await api.createTodo({ date: dateIso, text, extended: false, end_date: null, priority: 'normal' });
    } else if (quickType === 'meeting') {
      // Inicio en la media hora o hora en punto más cercana; duración 1 h
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const startMins = Math.min(Math.round(nowMins / 30) * 30, 23 * 60 + 30);
      const endMins = Math.min(startMins + 60, 23 * 60 + 59);
      const fmt = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      await api.createCustomMeeting({
        date: dateIso, title: text, start_time: fmt(startMins), end_time: fmt(endMins),
        all_day: false, repeat: 'none', repeat_until: null,
      });
    } else {
      await api.createEvent({ date: dateIso, title: text, kind: quickType });
    }
    setQuickText('');
    reloadAll();
  };

  const getDayItems = useCallback((dateIso) => buildDayItems({
    dateIso,
    events: weekEvents[dateIso] || [],
    meetings: weekMeetings[dateIso] || [],
    todos: weekTodos[dateIso] || [],
    order: weekOrder[dateIso] || [],
  }), [weekEvents, weekMeetings, weekTodos, weekOrder]);

  const clearDragState = () => {
    setDropTarget(null);
    setDragKey(null);
    hideDropMarkers(rootRef.current);
  };

  // FLIP: guarda dónde estaba cada tarjeta antes de un movimiento para animarla hasta su nuevo sitio.
  // Una tarea multi-día aparece en varias columnas con la misma clave: se identifica por día + clave.
  const captureRects = () => {
    if (!rootRef.current || prefersReducedMotion()) return;
    const byDay = new Map();
    const byKey = new Map();
    rootRef.current.querySelectorAll('[data-item-key]').forEach(el => {
      const rect = el.getBoundingClientRect();
      byDay.set(`${el.dataset.itemDay}|${el.dataset.itemKey}`, rect);
      byKey.set(el.dataset.itemKey, byKey.has(el.dataset.itemKey) ? null : rect);
    });
    flipRectsRef.current = { byDay, byKey };
  };

  useLayoutEffect(() => {
    const saved = flipRectsRef.current;
    if (!saved || !rootRef.current) return;
    flipRectsRef.current = null;
    const nodes = [...rootRef.current.querySelectorAll('[data-item-key]')];
    const counts = new Map();
    nodes.forEach(el => counts.set(el.dataset.itemKey, (counts.get(el.dataset.itemKey) || 0) + 1));
    nodes.forEach(el => {
      // Si cambió de día (la tarjeta ya no está en su columna), se anima desde su columna anterior solo si no es multi-día
      const old = saved.byDay.get(`${el.dataset.itemDay}|${el.dataset.itemKey}`)
        ?? (counts.get(el.dataset.itemKey) === 1 ? saved.byKey.get(el.dataset.itemKey) : null);
      if (!old) return;
      el.getAnimations().forEach(a => { if (a.id === 'wv-flip') a.cancel(); });
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }],
        { id: 'wv-flip', duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)' },
      );
    });
  });

  const markLanded = id => {
    setLandedKey(id);
    setTimeout(() => setLandedKey(k => (k === id ? null : k)), 700);
  };

  const startItemDrag = (e, item, dateIso) => {
    e.stopPropagation();
    draggingRef.current = true;
    dragInfoRef.current = { key: item.key, date: dateIso };
    // en el siguiente frame, para que la imagen fantasma del navegador salga sin atenuar
    requestAnimationFrame(() => { if (dragInfoRef.current?.key === item.key) setDragKey(`${dateIso}|${item.key}`); });
    const dt = e.dataTransfer;
    dt.setData('application/x-item-key', item.key);
    dt.setData('application/x-item-date', dateIso);
    if (item.type === 'todo') {
      dt.setData('application/x-todo-id', String(item.data.id));
      // _displayDate: la columna donde se arrastra (puede ser una continuación multi-día)
      dt.setData('application/x-todo-date', item.data._displayDate || item.data.date || '');
    }
    dt.setData('text/plain', item.data.text || item.data.title || '');
    dt.effectAllowed = 'move';
  };

  const endItemDrag = () => {
    draggingRef.current = false;
    dragInfoRef.current = null;
    clearDragState();
  };

  const dragOverColumn = (e, dateIso) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== dateIso) setDropTarget(dateIso);
    const body = e.currentTarget.querySelector('.wv-col-body');
    if (!body) return;
    hideDropMarkers(rootRef.current, body);
    const beforeKey = getBeforeKeyByPointer(e.currentTarget, e.clientY);
    // Sin marcador si soltar ahí dejaría el elemento donde ya está
    const drag = dragInfoRef.current;
    if (drag && drag.date === dateIso) {
      const keys = [...body.querySelectorAll(':scope > [data-item-key]')].map(el => el.dataset.itemKey);
      const at = keys.indexOf(drag.key);
      if (at !== -1 && (beforeKey === drag.key || beforeKey === (keys[at + 1] ?? null))) {
        body.removeAttribute('data-drop');
        return;
      }
    }
    placeDropMarker(body, beforeKey);
  };

  const dragLeaveColumn = (e) => {
    // dragleave también salta al pasar sobre los hijos: solo se limpia al salir de la columna
    if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
    clearDragState();
  };

  // Suelta cualquier elemento (tarea, evento, entrega o reunión) en un día, en la posición del puntero
  const dropItem = async (e, targetDate) => {
    e.preventDefault();
    e.stopPropagation();
    const beforeKey = getBeforeKeyByPointer(e.currentTarget, e.clientY);
    draggingRef.current = false;
    dragInfoRef.current = null;
    clearDragState();
    const dt = e.dataTransfer;
    let key = dt.getData('application/x-item-key');
    let sourceDate = dt.getData('application/x-item-date');
    const legacyTodoId = dt.getData('application/x-todo-id');
    if (!key && legacyTodoId) {
      // arrastre desde el panel del día u otras vistas, que solo envían la tarea
      key = `todo-${legacyTodoId}`;
      sourceDate = dt.getData('application/x-todo-date');
    }
    if (!key || key === beforeKey) return;

    const dash = key.indexOf('-');
    const type = key.slice(0, dash);
    const id = type === 'meeting' ? null : Number(key.slice(dash + 1));
    const sameDay = sourceDate === targetDate;
    if (!sameDay && type === 'meeting') return; // las reuniones no cambian de día

    const current = getDayItems(targetDate).map(item => item.key);
    const base = current.filter(k => k !== key);
    const at = beforeKey ? base.indexOf(beforeKey) : -1;
    if (at === -1) base.push(key); else base.splice(at, 0, key);
    if (sameDay && base.join('|') === current.join('|')) return; // sin cambios

    const sourceTodos = type === 'todo' ? (sourceDate ? weekTodos[sourceDate] : unassigned) : null;
    const movedTodo = sourceTodos?.find(t => t.id === id)
      ?? (type === 'todo' ? overdue.find(t => t.id === id) : null)
      ?? null;
    const movedEvent = type === 'event' ? (weekEvents[sourceDate] || []).find(ev => ev.id === id) : null;
    if (type === 'event' && !sameDay && !movedEvent) return;

    mutationRef.current += 1;
    captureRects();
    markLanded(`${targetDate}|${key}`);
    setWeekOrder(prev => ({ ...prev, [targetDate]: base }));
    if (type === 'event' && !sameDay) {
      setWeekEvents(prev => ({
        ...prev,
        [sourceDate]: (prev[sourceDate] || []).filter(ev => ev.id !== id),
        [targetDate]: [...(prev[targetDate] || []), { ...movedEvent, date: targetDate }],
      }));
    }
    if (type === 'todo') {
      const rank = new Map(base.filter(k => k.startsWith('todo-')).map((k, i) => [Number(k.slice(5)), i]));
      if (!sameDay) {
        setUnassigned(prev => prev.filter(t => t.id !== id));
        setOverdue(prev => prev.filter(t => t.id !== id));
      }
      setWeekTodos(prev => {
        let next = prev;
        if (!sameDay && movedTodo) {
          // la tarea empieza en el día destino y conserva su duración
          const endDate = movedTodo.end_date && movedTodo.date
            ? shiftIso(targetDate, daysBetween(movedTodo.date, movedTodo.end_date))
            : movedTodo.end_date;
          next = removeTodoFromBuckets(prev, id);
          next = { ...next, [targetDate]: [...(next[targetDate] || []), { ...movedTodo, date: targetDate, end_date: endDate, _displayDate: targetDate }] };
        }
        const list = [...(next[targetDate] || [])].sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6));
        return { ...next, [targetDate]: list };
      });
    }

    try {
      if (!sameDay && type === 'todo') await api.updateTodo(id, { date: targetDate });
      if (!sameDay && movedEvent) await api.updateEvent(id, { date: targetDate, title: movedEvent.title, kind: movedEvent.kind });
      await api.setDayOrder(targetDate, base);
      if (type === 'todo') {
        // reorderTodos exige exactamente las tareas que empiezan ese día (las continuaciones multi-día no cuentan)
        const targetTodos = weekTodos[targetDate] || [];
        const owned = base.filter(k => k.startsWith('todo-')).map(k => Number(k.slice(5)))
          .filter(tid => (tid === id && !sameDay) || targetTodos.some(t => t.id === tid && t.date === targetDate));
        if (owned.length > 0) await api.reorderTodos(targetDate, owned);
      }
    } catch { /* se recarga el estado real justo debajo */ }
    mutationRef.current += 1;
    reloadAll();
  };

  // Tarea soltada sobre un día del calendario mensual en miniatura: cambia de día (al final de su lista)
  const dropTodoOnDay = async (todoId, targetDate, sourceDate) => {
    draggingRef.current = false;
    dragInfoRef.current = null;
    clearDragState();
    if (sourceDate === targetDate) return;
    mutationRef.current += 1;
    captureRects();
    setWeekTodos(prev => removeTodoFromBuckets(prev, todoId));
    setUnassigned(prev => prev.filter(t => t.id !== todoId));
    setOverdue(prev => prev.filter(t => t.id !== todoId));
    try { await api.updateTodo(todoId, { date: targetDate }); } catch { /* se recarga debajo */ }
    mutationRef.current += 1;
    reloadAll();
  };

  const markDone = async (id) => { await api.updateTodo(id, { done: 1 }); reloadAll(); };
  const unmarkDone = async (id) => { await api.updateTodo(id, { done: 0 }); reloadAll(); };
  const deleteTodo = async (id) => { await api.deleteTodo(id); reloadAll(); };
  const carryOverTodo = async (id, toDate) => { await api.carryOverTodo(id, toDate); reloadAll(); };

  const addTodo = async (e) => {
    e.preventDefault();
    if (!todoText.trim()) return;
    await api.createTodo({ text: todoText.trim(), date: todoDate || null });
    setTodoText('');
    setTodoDate('');
    reloadAll();
  };

  // Weekend task counts
  const satTodos = weekTodos[iso(weekDays[5])] || [];
  const sunTodos = weekTodos[iso(weekDays[6])] || [];
  const weekendCount = satTodos.length + sunTodos.length;

  // Week label
  const monthNames = [...new Set(weekDays.map(d => MONTH_NAMES[d.getMonth()]))];
  const weekLabel = monthNames.length > 1
    ? `${weekDays[0].getDate()} ${MONTH_NAMES[weekDays[0].getMonth()]} – ${weekDays[6].getDate()} ${MONTH_NAMES[weekDays[6].getMonth()]}`
    : `${weekDays[0].getDate()} – ${weekDays[6].getDate()} ${MONTH_NAMES[weekDays[0].getMonth()]}`;

  const renderCol = (d, i) => {
    const dateIso = iso(d);
    const isToday = dateIso === todayIso;
    const items = getDayItems(dateIso);
    const isSelected = dateIso === selectedIso;
    const isDrop = dropTarget === dateIso;
    const eff = effectiveLabor(d, laborMap);
    const laborInfo = LABOR_TYPES[eff.type];
    const isSpecial = eff.type !== 'laborable';
    const labelText = eff.label || (isSpecial ? laborInfo?.label : null);
    const colStyle = isSpecial && laborInfo
      ? { '--day-color': laborInfo.color, '--day-text': laborInfo.text }
      : undefined;

    // Contenido de cada tipo: círculo a la izquierda + tarjeta con el mismo aspecto
    const renderItemBody = (item) => {
      if (item.type === 'todo') {
        const t = item.data;
        return (
          <>
            <input
              type="checkbox"
              checked={!!t.done}
              onChange={() => (t.done ? unmarkDone(t.id) : markDone(t.id))}
              className="wv-task-check"
            />
            <TaskLabel todo={t} compact={dateIso !== todayIso} onChanged={() => { loadTodos(); loadOverdue(); onReload?.(); }} />
          </>
        );
      }
      if (item.type === 'event') {
        const ev = item.data;
        const isDelivery = ev.kind === 'delivery';
        return (
          <>
            <input
              type="checkbox"
              checked={!!ev.done}
              onChange={async () => { await api.updateEvent(ev.id, { done: ev.done ? 0 : 1 }); reloadAll(); }}
              className="wv-event-check"
              aria-label={ev.done ? 'Marcar como pendiente' : 'Marcar como hecho'}
            />
            <div className="wv-card">
              <div className="wv-card-main">
                <span className="wv-card-title" title={ev.title}>
                  <span className="wv-card-icon" aria-hidden="true">{isDelivery ? '📦' : '📌'}</span>
                  {ev.title}
                </span>
                <span className="wv-card-sub">{isDelivery ? 'Entrega' : 'Evento'}</span>
              </div>
              <ItemActionsMenu
                ariaLabel={isDelivery ? 'Opciones de entrega' : 'Opciones de evento'}
                actions={[
                  { label: 'Editar', icon: Pencil, onClick: () => setEditingEvent(ev) },
                  { label: 'Eliminar', icon: Trash2, danger: true, onClick: async () => { await api.deleteEvent(ev.id); reloadAll(); } },
                ]}
              />
            </div>
          </>
        );
      }
      const m = item.data;
      const absent = m.attending === false || m.attending === 0;
      const meetingType = m.isCustom ? 'custom' : 'outlook';
      const meetingRef = m.isCustom ? String(m.customId) : m.uid;
      return (
        <>
          {/* círculo check/cancel de asistencia */}
          {!m.isCustom ? (
            <button
              type="button"
              className={`wv-meeting-att ${absent ? 'absent' : 'attending'}`}
              onClick={async () => {
                await api.setMeetingAttendance(m.uid, dateIso, absent);
                reloadAll();
              }}
              title={absent ? 'Marcar como asisto' : 'Marcar como no asisto'}
            />
          ) : (
            <span className="wv-meeting-att attending" style={{ pointerEvents: 'none' }} />
          )}
          <div className="wv-card">
            <div className="wv-card-main">
              <span className="wv-card-title" title={m.title}>
                <span className="wv-card-icon" aria-hidden="true">📅</span>
                {m.repeat === 'weekly' && <span className="meeting-recurring-badge" title="Se repite cada semana">↻ </span>}
                {m.title}
              </span>
              <span className="wv-card-sub">
                {m.allDay ? 'Todo el día' : `${m.startTime || ''}${m.endTime ? `–${m.endTime}` : ''}`}
              </span>
            </div>
            <ItemActionsMenu
              ariaLabel="Opciones de reunión"
              actions={[
                {
                  label: 'Asignar proyecto',
                  icon: FolderKanban,
                  submenu: [
                    ...(m.project_id ? [{ key: 'none', label: 'Sin proyecto', onClick: async () => { await api.setMeetingProject(m.uid, dateIso, null); reloadAll(); } }] : []),
                    ...projects.map((p, i) => ({
                      key: p.id, label: p.name, color: p.color, active: p.id === m.project_id, index: i,
                      onClick: async () => { await api.setMeetingProject(m.uid, dateIso, p.id); reloadAll(); },
                    })),
                  ],
                },
                { label: 'Notas', icon: FileText, onClick: () => setNotesEditor({ meetingType, meetingRef, meetingDate: dateIso, meetingTitle: m.title }) },
                ...(m.isCustom ? [
                  { label: 'Editar', icon: Pencil, onClick: () => setEditingMeetingId(m.customId) },
                  {
                    label: 'Eliminar', icon: Trash2, danger: true,
                    onClick: async () => {
                      if (m.repeat === 'weekly' && !confirm('Esta reunión se repite cada semana. Se eliminará la serie completa. ¿Continuar?')) return;
                      await api.deleteCustomMeeting(m.customId);
                      reloadAll();
                    },
                  },
                ] : []),
              ]}
            />
          </div>
        </>
      );
    };

    const renderItem = (item) => {
      const m = item.type === 'meeting' ? item.data : null;
      const absent = m && (m.attending === false || m.attending === 0);
      const className = [
        'wv-item', `wv-item-${item.type}`,
        item.type === 'todo' ? 'wv-task' : '',
        item.data.done ? 'is-done' : '',
        m?.project_color ? 'has-project' : '',
        absent ? 'absent' : '',
        dragKey === `${dateIso}|${item.key}` ? 'is-drag-source' : '',
        landedKey === `${dateIso}|${item.key}` ? 'is-landed' : '',
      ].filter(Boolean).join(' ');
      return (
        <div
          key={item.key}
          data-item-key={item.key}
          data-item-day={dateIso}
          className={className}
          style={m ? { '--meeting-color': m.project_color || (m.isCustom ? '#a78bfa' : '#94a3b8') } : undefined}
          draggable
          onDragStart={e => startItemDrag(e, item, dateIso)}
          onDragEnd={endItemDrag}
        >
          {renderItemBody(item)}
        </div>
      );
    };

    return (
      <div
        key={dateIso}
        className={`wv-col ${isToday ? 'today' : ''} ${dateIso === selectedIso ? 'selected' : ''} ${isDrop ? 'drop-hover' : ''} ${isSpecial ? 'special' : ''} wv-col-${eff.type}`}
        title={labelText || ''}
        style={colStyle}
        onClick={() => setSelectedDate(dateIso)}
        onDragOver={e => dragOverColumn(e, dateIso)}
        onDragLeave={dragLeaveColumn}
        onDrop={e => dropItem(e, dateIso)}
      >
        {!dayMode && (
          <div className="wv-col-head" onClick={() => setSelectedDate(dateIso)}>
            <span className="wv-col-dow">{DOW_SHORT[i]}</span>
            <span className={`wv-col-num ${isToday ? 'today' : ''}`}>{d.getDate()}</span>
          </div>
        )}
        {isSelected && (
          <form className="wv-quick-add" onSubmit={e => quickAdd(e, dateIso)}>
            <QuickTypeDropdown
              types={QUICK_TYPES}
              value={quickType}
              onChange={setQuickType}
              onSelected={() => quickInputRef.current?.focus()}
            />
            <input
              ref={quickInputRef}
              type="text"
              className="wv-quick-input"
              value={quickText}
              onChange={e => setQuickText(e.target.value)}
              placeholder={QUICK_TYPES.find(t => t.key === quickType).placeholder}
            />
          </form>
        )}
        {labelText && (
          <div className="wv-col-label"><span>{labelText}</span></div>
        )}
        <div className="wv-col-body">
          {items.map(renderItem)}
        </div>
      </div>
    );
  };

  const meetingsRefreshKey = (weekMeetings[selectedIso] || []).map(m => `${m.uid}|${m.attending}|${m.project_id ?? ''}|${m.startTime}|${m.endTime}|${m.title}`).join(';');

  const modals = (
    <>
      {/* Meeting Notes Editor Modal */}
      {notesEditor && (
        <MeetingNotesEditor
          meetingType={notesEditor.meetingType}
          meetingRef={notesEditor.meetingRef}
          meetingDate={notesEditor.meetingDate}
          meetingTitle={notesEditor.meetingTitle}
          projectName={notesEditor.projectName}
          onClose={() => setNotesEditor(null)}
        />
      )}

      {editingEvent && (
        <EditEventModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSaved={reloadAll}
        />
      )}

      {editingMeetingId != null && (
        <CreateMeetingModal
          meetingId={editingMeetingId}
          onClose={() => setEditingMeetingId(null)}
          onCreated={reloadAll}
        />
      )}
    </>
  );

  if (dayMode) {
    const selectedDay = new Date(selectedIso + 'T00:00:00');
    return (
      <div className="wv wv-embedded" ref={rootRef}>
        <DayDetailPanel
          date={selectedIso}
          laborMap={laborMap}
          projects={projects}
          onReload={reloadAll}
          showTasksAndEvents={false}
          showMeetings={false}
          meetingsAsHours
          refreshKey={meetingsRefreshKey}
        />
        {renderCol(selectedDay, (selectedDay.getDay() + 6) % 7)}
        {modals}
      </div>
    );
  }

  return (
    <div className="wv" ref={rootRef}>
      {/* Toolbar */}
      <section className="toolbar">
        <div className="month-nav">
          <button className="btn btn-icon" onClick={() => setWeekOffset(w => w - 1)}>‹</button>
          <h1 className="month-title">{weekLabel} <span>{weekDays[0].getFullYear()}</span></h1>
          <button className="btn btn-icon" onClick={() => setWeekOffset(w => w + 1)}>›</button>
          {weekOffset !== 0 && <button className="btn btn-ghost" onClick={() => setWeekOffset(0)}>Hoy</button>}
        </div>
      </section>

      {/* Main layout: weekday grid + selected day panel */}
      <div className="wv-layout">
        {/* Week columns (Mon–Fri) */}
        <div className="wv-grid">
          {weekDays.slice(0, 5).map((d, i) => renderCol(d, i))}
        </div>

        <aside className="wv-day-panel">
          <DayDetailPanel
            key={selectedIso}
            date={selectedIso}
            laborMap={laborMap}
            projects={projects}
            onReload={reloadAll}
            showTasksAndEvents={false}
            showMeetings={false}
            meetingsAsHours
            refreshKey={meetingsRefreshKey}
            afterWork={
              <WeeklyMonthSummary
                monthIso={monthKey}
                selectedIso={selectedIso}
                todayIso={todayIso}
                laborMap={laborMap}
                eventDates={monthEventDates}
                hoursByDay={monthHours}
                onSelect={selectDay}
                onDropTodo={dropTodoOnDay}
              />
            }
          />
        </aside>
      </div>

      {/* Collapsible weekend */}
      <div className="wv-weekend">
        <button className="wv-weekend-toggle" onClick={() => setWeekendOpen(o => !o)}>
          <span className="wv-weekend-arrow">{weekendOpen ? '▾' : '▸'}</span>
          <span>Fin de semana</span>
          {weekendCount > 0 && <span className="wv-weekend-badge">{weekendCount}</span>}
        </button>
        {weekendOpen && (
          <div className="wv-weekend-grid">
            {renderCol(weekDays[5], 5)}
            {renderCol(weekDays[6], 6)}
          </div>
        )}
      </div>

      {modals}
    </div>
  );
}
