import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { iso, MONTH_NAMES, LABOR_TYPES, effectiveLabor } from '../utils.js';
import MeetingNotesEditor from './MeetingNotesEditor.jsx';
import CreateMeetingModal from './CreateMeetingModal.jsx';

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

export default function WeeklyView({ today, onReload, laborMap = {} }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekTodos, setWeekTodos] = useState({});
  const [weekMeetings, setWeekMeetings] = useState({});
  const [overdue, setOverdue] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [dropTarget, setDropTarget] = useState(null);
  const [todoText, setTodoText] = useState('');
  const [todoDate, setTodoDate] = useState('');
  const [weekendOpen, setWeekendOpen] = useState(false);
  const [notesEditor, setNotesEditor] = useState(null);
  const [showCreateMeeting, setShowCreateMeeting] = useState(null); // date string or null

  const todayIso = iso(today);
  const baseDate = new Date(today);
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  const weekDays = getWeekDays(baseDate);
  const weekFrom = iso(weekDays[0]);
  const weekTo = iso(weekDays[6]);

  const loadTodos = useCallback(async () => {
    const todos = await api.listTodos({ from: weekFrom, to: weekTo });
    const map = {};
    weekDays.forEach(d => { map[iso(d)] = []; });
    todos.forEach(t => { if (map[t.date]) map[t.date].push(t); });
    setWeekTodos(map);
  }, [weekFrom, weekTo]);

  const loadMeetings = useCallback(async () => {
    try {
      const meetings = await api.listMeetings({ from: weekFrom, to: weekTo });
      const map = {};
      weekDays.forEach(d => { map[iso(d)] = []; });
      meetings.forEach(m => { if (map[m.date]) map[m.date].push(m); });
      setWeekMeetings(map);
    } catch { setWeekMeetings({}); }
  }, [weekFrom, weekTo]);

  const loadOverdue = useCallback(async () => {
    try { setOverdue(await api.overdueTodos(todayIso)); } catch { setOverdue([]); }
  }, [todayIso]);

  const loadUnassigned = useCallback(async () => {
    try { setUnassigned(await api.unassignedTodos()); } catch { setUnassigned([]); }
  }, []);

  const reloadAll = useCallback(() => {
    loadTodos(); loadMeetings(); loadOverdue(); loadUnassigned(); onReload?.();
  }, [loadTodos, loadMeetings, loadOverdue, loadUnassigned, onReload]);

  useEffect(() => { loadTodos(); loadMeetings(); loadOverdue(); loadUnassigned(); }, [loadTodos, loadMeetings, loadOverdue, loadUnassigned]);

  useEffect(() => {
    const id = setInterval(() => { loadTodos(); loadMeetings(); loadOverdue(); loadUnassigned(); }, 5000);
    return () => clearInterval(id);
  }, [loadTodos, loadMeetings, loadOverdue, loadUnassigned]);

  const handleDragStart = (e, todo) => {
    e.dataTransfer.setData('application/x-todo-id', String(todo.id));
    e.dataTransfer.setData('text/plain', todo.text);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = async (e, dateIso) => {
    e.preventDefault();
    setDropTarget(null);
    const todoId = e.dataTransfer.getData('application/x-todo-id');
    if (todoId) {
      await api.updateTodo(Number(todoId), { date: dateIso });
      reloadAll();
    }
  };

  const handleDropUnassign = async (e) => {
    e.preventDefault();
    setDropTarget(null);
    const todoId = e.dataTransfer.getData('application/x-todo-id');
    if (todoId) {
      await api.updateTodo(Number(todoId), { date: null });
      reloadAll();
    }
  };

  const markDone = async (id) => { await api.updateTodo(id, { done: 1 }); reloadAll(); };
  const unmarkDone = async (id) => { await api.updateTodo(id, { done: 0 }); reloadAll(); };
  const deleteTodo = async (id) => { await api.deleteTodo(id); reloadAll(); };

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
    const todos = weekTodos[dateIso] || [];
    const meetings = weekMeetings[dateIso] || [];
    const isDrop = dropTarget === dateIso;
    const pending = todos.filter(t => !t.done);
    const done = todos.filter(t => t.done);
    const eff = effectiveLabor(d, laborMap);
    const laborInfo = LABOR_TYPES[eff.type];
    const isSpecial = eff.type !== 'laborable';
    const labelText = eff.label || (isSpecial ? laborInfo?.label : null);
    const colStyle = isSpecial && laborInfo
      ? { '--day-color': laborInfo.color, '--day-text': laborInfo.text }
      : undefined;

    return (
      <div
        key={dateIso}
        className={`wv-col ${isToday ? 'today' : ''} ${isDrop ? 'drop-hover' : ''} ${isSpecial ? 'special' : ''} wv-col-${eff.type}`}
        title={labelText || ''}
        style={colStyle}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget(dateIso); }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={e => handleDrop(e, dateIso)}
      >
        <div className="wv-col-head">
          <span className="wv-col-dow">{DOW_SHORT[i]}</span>
          <span className={`wv-col-num ${isToday ? 'today' : ''}`}>{d.getDate()}</span>
          <button className="wv-col-add-meeting" onClick={() => setShowCreateMeeting(dateIso)} title="Nueva reunión">+📅</button>
        </div>
        {labelText && (
          <div className="wv-col-label"><span>{labelText}</span></div>
        )}
        <div className="wv-col-body">
          {/* Meetings */}
          {meetings.length > 0 && (
            <div className="wv-meetings-section">
              {meetings.map(m => {
                const meetingType = m.isCustom ? 'custom' : 'outlook';
                const meetingRef = m.isCustom ? String(m.customId) : m.uid;
                return (
                  <div key={m.uid} className={`wv-meeting ${m.isCustom ? 'custom' : ''}`}>
                    <div className="wv-meeting-color" style={{ background: m.project_color || (m.isCustom ? '#a78bfa' : '#64748b') }} />
                    <div className="wv-meeting-info">
                      <span className="wv-meeting-title">{m.title}</span>
                      <span className="wv-meeting-time">
                        {m.allDay ? 'Todo el día' : `${m.startTime || ''}${m.endTime ? `–${m.endTime}` : ''}`}
                      </span>
                    </div>
                    <button
                      className="wv-meeting-notes-btn"
                      onClick={() => setNotesEditor({ meetingType, meetingRef, meetingDate: dateIso })}
                      title="Notas"
                    >📝</button>
                    {m.isCustom && (
                      <button
                        className="btn-delete wv-task-del"
                        onClick={async () => { await api.deleteCustomMeeting(m.customId); reloadAll(); }}
                      >✕</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Tasks */}
          {pending.map(t => (
            <div key={t.id} className="wv-task" draggable onDragStart={e => handleDragStart(e, t)}>
              <input type="checkbox" checked={false} onChange={() => markDone(t.id)} className="wv-task-check" />
              <span className="wv-task-text">{t.text}</span>
              <button className="btn-delete wv-task-del" onClick={() => deleteTodo(t.id)}>✕</button>
            </div>
          ))}
          {done.length > 0 && (
            <div className="wv-done-section">
              {done.map(t => (
                <div key={t.id} className="wv-task done">
                  <input type="checkbox" checked onChange={() => unmarkDone(t.id)} className="wv-task-check" />
                  <span className="wv-task-text">{t.text}</span>
                  <button className="btn-delete wv-task-del" onClick={() => deleteTodo(t.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="wv">
      {/* Toolbar */}
      <section className="toolbar">
        <div className="month-nav">
          <button className="btn btn-icon" onClick={() => setWeekOffset(w => w - 1)}>‹</button>
          <h1 className="month-title">{weekLabel} <span>{weekDays[0].getFullYear()}</span></h1>
          <button className="btn btn-icon" onClick={() => setWeekOffset(w => w + 1)}>›</button>
          {weekOffset !== 0 && <button className="btn btn-ghost" onClick={() => setWeekOffset(0)}>Hoy</button>}
        </div>
      </section>

      {/* Main layout: left panel + weekday grid */}
      <div className="wv-layout">
        {/* Left panel: create + unassigned + overdue */}
        <div
          className={`wv-panel ${dropTarget === 'unassign' ? 'drop-hover' : ''}`}
          onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropTarget('unassign'); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={handleDropUnassign}
        >
          {/* Creator */}
          <div className="wv-panel-section">
            <div className="wv-panel-title">✏️ Nueva tarea</div>
            <form className="wv-creator-form" onSubmit={addTodo}>
              <input
                type="text"
                placeholder="Escribe una tarea..."
                value={todoText}
                onChange={e => setTodoText(e.target.value)}
                className="wv-creator-input"
              />
              <input
                type="date"
                value={todoDate}
                onChange={e => setTodoDate(e.target.value)}
                className="wv-creator-date"
                title="Fecha (vacío = sin asignar)"
              />
              <button type="submit" className="wv-creator-btn" disabled={!todoText.trim()}>+</button>
            </form>
          </div>

          {/* Unassigned tasks */}
          {unassigned.length > 0 && (
            <div className="wv-panel-section">
              <div className="wv-panel-title">📋 Sin asignar <span className="wv-panel-count">{unassigned.length}</span></div>
              <div className="wv-panel-list">
                {unassigned.map(t => (
                  <div key={t.id} className="wv-panel-item" draggable onDragStart={e => handleDragStart(e, t)}>
                    <span className="wv-panel-item-text">{t.text}</span>
                    <button className="btn-delete wv-task-del" onClick={() => deleteTodo(t.id)}>✕</button>
                  </div>
                ))}
              </div>
              <p className="wv-panel-hint">Arrastra a un día para asignar</p>
            </div>
          )}

          {/* Overdue warning */}
          {overdue.length > 0 && (
            <div className="wv-panel-section wv-panel-overdue">
              <div className="wv-panel-title wv-panel-warn">⚠️ No completadas <span className="wv-panel-count warn">{overdue.length}</span></div>
              <div className="wv-panel-list">
                {overdue.map(t => (
                  <div key={t.id} className="wv-panel-item overdue" draggable onDragStart={e => handleDragStart(e, t)}>
                    <div className="wv-panel-item-main">
                      <span className="wv-panel-item-text">{t.text}</span>
                      <span className="wv-panel-item-date">{t.date}</span>
                    </div>
                    <div className="wv-panel-item-actions">
                      <button className="wv-panel-item-done" onClick={() => markDone(t.id)} title="Completar">✓</button>
                      <button className="btn-delete wv-task-del" onClick={() => deleteTodo(t.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="wv-panel-hint">Arrastra a un día para reasignar</p>
            </div>
          )}
        </div>

        {/* Right: week columns (Mon–Fri) */}
        <div className="wv-grid">
          {weekDays.slice(0, 5).map((d, i) => renderCol(d, i))}
        </div>
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

      {/* Meeting Notes Editor Modal */}
      {notesEditor && (
        <MeetingNotesEditor
          meetingType={notesEditor.meetingType}
          meetingRef={notesEditor.meetingRef}
          meetingDate={notesEditor.meetingDate}
          onClose={() => setNotesEditor(null)}
        />
      )}

      {/* Create Meeting Modal */}
      {showCreateMeeting && (
        <CreateMeetingModal
          initialDate={showCreateMeeting}
          onClose={() => setShowCreateMeeting(null)}
          onCreated={reloadAll}
        />
      )}
    </div>
  );
}
