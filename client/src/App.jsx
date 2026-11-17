import { lazy, Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { api } from './api.js';
import { MONTH_NAMES, iso, cacheGet, cacheSet, getThemePref, setThemePref } from './utils.js';
import Calendar from './components/Calendar.jsx';
import DayDetailPanel from './components/DayDetailPanel.jsx';
import LaborSidebar from './components/LaborSidebar.jsx';
import WeeklyView from './components/WeeklyView.jsx';
import MobileNav from './components/MobileNav.jsx';
import DaySheet from './components/DaySheet.jsx';
import TodayScreen from './components/TodayScreen.jsx';
import { FluidTabs } from './components/FluidTabs.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { LABOR_TYPES, LABOR_ORDER } from './utils.js';

const YearView = lazy(() => import('./components/YearView.jsx'));
const ProjectsPage = lazy(() => import('./components/ProjectsPage.jsx'));
const NotesPage = lazy(() => import('./components/NotesPage.jsx'));
// DESACTIVADO (no eliminar): PixelAgent (agente IA gemma)
// const PixelAgent = lazy(() => import('./components/PixelAgent.jsx'));

const monthKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export default function App({ onLogout = null }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(iso(today));
  const [view, setView] = useState('weekly'); // 'weekly' | 'monthly' | 'annual' | 'projects' | 'notes'
  const [calendarTab, setCalendarTab] = useState('weekly'); // última sub-vista de calendario activa
  const [activeType, setActiveType] = useState('vacaciones');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState(getThemePref);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // DESACTIVADO (no eliminar): estado del PixelAgent (agente IA gemma)
  // const [showPixelAgent, setShowPixelAgent] = useState(false);

  const [apiOffline, setApiOffline] = useState(false);

  // Estado inicial desde la caché local: la app se pinta al instante con los
  // últimos datos conocidos y se actualiza cuando responde el servidor.
  const initialMonth = useMemo(() => cacheGet(`month:${monthKeyOf(cursor)}`, null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [projects, setProjects] = useState(() => cacheGet('projects', []));
  const [projectStats, setProjectStats] = useState(() => initialMonth?.stats || []);
  const [monthWorkEntries, setMonthWorkEntries] = useState(() => initialMonth?.work || []);
  const [laborMap, setLaborMap] = useState(() => cacheGet(`labor:${today.getFullYear()}`, {}));
  const [daySummaries, setDaySummaries] = useState(() => initialMonth?.map || {});
  const [settings, setSettings] = useState(() => cacheGet('settings', { vacation_total: '23' }));

  const reloadProjects = useCallback(async () => {
    try {
      const list = await api.listProjects();
      const next = Array.isArray(list) ? list : [];
      setProjects(next);
      cacheSet('projects', next);
    } catch (err) {
      // sin conexión: se mantienen los últimos datos conocidos
      console.error('Error cargando proyectos:', err);
    }
  }, []);
  // proyectos hibernados no deben ofrecerse al registrar horas/reuniones
  const activeProjects = useMemo(() => projects.filter(p => p.is_active !== 0), [projects]);
  const reloadSettings = useCallback(async () => {
    try {
      const s = await api.getSettings();
      const next = s && typeof s === 'object' ? s : { vacation_total: '23' };
      setSettings(next);
      cacheSet('settings', next);
    } catch (err) {
      console.error('Error cargando ajustes:', err);
    }
  }, []);

  const reloadLabor = useCallback(async () => {
    const year = cursor.getFullYear();
    const cached = cacheGet(`labor:${year}`, null);
    if (cached) setLaborMap(cached);
    try {
      const rows = await api.listLabor(`${year}-01-01`, `${year}-12-31`);
      const map = {};
      (rows || []).forEach(r => { if (r && r.date) map[r.date] = r; });
      setLaborMap(map);
      cacheSet(`labor:${year}`, map);
    } catch (err) {
      console.error('Error cargando jornada laboral:', err);
      if (!cached) setLaborMap({});
    }
  }, [cursor]);

  const reloadMonth = useCallback(async () => {
    const cacheKey = `month:${monthKeyOf(cursor)}`;
    const cached = cacheGet(cacheKey, null);
    if (cached) {
      setMonthWorkEntries(cached.work || []);
      setDaySummaries(cached.map || {});
      setProjectStats(cached.stats || []);
    }
    try {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const from = iso(new Date(y, m, 1));
      const to = iso(new Date(y, m + 1, 0));
      // Si falla alguna petición se lanza el error y se conservan los datos
      // en caché, en vez de pintar un mes vacío.
      const [work, events, todos, stats, meetings] = await Promise.all([
        api.listWork({ from, to }),
        api.listEvents({ from, to }),
        api.listTodos({ from, to }),
        api.projectStats(from, to).catch(() => []),
        api.listMeetings({ from, to }).catch(() => []),
      ]);
      const map = {};
      const ensure = (date) => (map[date] ||= { work: [], events: [], todos: [], meetings: [] });
      (work || []).forEach(w => { if (w && w.date) ensure(w.date).work.push(w); });
      (events || []).forEach(e => { if (e && e.date) ensure(e.date).events.push(e); });
      // Expand multi-day tasks across every day in their range
      (todos || []).forEach(t => {
        if (!t || !t.date) return;
        const end = t.end_date || t.date;
        let cur = t.date;
        while (cur <= end && cur <= to) {
          ensure(cur).todos.push({ ...t, _displayDate: cur });
          if (cur >= to) break;
          const d = new Date(cur + 'T00:00:00'); d.setDate(d.getDate() + 1);
          cur = iso(d);
        }
      });
      (meetings || []).forEach(mt => { if (mt && mt.date) ensure(mt.date).meetings.push(mt); });
      const nextWork = Array.isArray(work) ? work : [];
      const nextStats = Array.isArray(stats) ? stats : [];
      setMonthWorkEntries(nextWork);
      setDaySummaries(map);
      setProjectStats(nextStats);
      cacheSet(cacheKey, { work: nextWork, map, stats: nextStats });
    } catch (err) {
      console.error('Error cargando datos del mes:', err);
      if (!cached) {
        setMonthWorkEntries([]);
        setDaySummaries({});
        setProjectStats([]);
      }
    }
  }, [cursor]);

  // Banner de conexión: escucha el estado de las llamadas a la API
  useEffect(() => {
    const onApiStatus = (e) => setApiOffline(!e.detail.ok);
    window.addEventListener('api-status', onApiStatus);
    return () => window.removeEventListener('api-status', onApiStatus);
  }, []);

  // Mientras está offline, reintenta cada 10s para detectar la recuperación
  useEffect(() => {
    if (!apiOffline) return;
    const id = setInterval(() => {
      api.getSettings().then(() => { reloadMonth(); reloadLabor(); }).catch(() => {});
    }, 10000);
    return () => clearInterval(id);
  }, [apiOffline, reloadMonth, reloadLabor]);

  useEffect(() => { reloadProjects(); reloadSettings(); }, [reloadProjects, reloadSettings]);
  useEffect(() => { reloadLabor(); reloadMonth(); }, [reloadLabor, reloadMonth]);

  useEffect(() => {
    const id = setInterval(() => {
      api.refreshMeetings().then(() => reloadMonth()).catch(() => {});
    }, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [reloadMonth]);

  // DESACTIVADO (no eliminar): carga diferida del PixelAgent (agente IA gemma)
  /*
  useEffect(() => {
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const scheduleId = hasIdle
      ? window.requestIdleCallback(() => setShowPixelAgent(true), { timeout: 1500 })
      : setTimeout(() => setShowPixelAgent(true), 1200);

    return () => {
      if (hasIdle) window.cancelIdleCallback?.(scheduleId);
      else clearTimeout(scheduleId);
    };
  }, []);
  */

  const vacationTotal = parseInt(settings.vacation_total || '23', 10);
  const vacationUsed = useMemo(
    () => Object.values(laborMap).filter(d => d.type === 'vacaciones').length,
    [laborMap]
  );

  const prevMonth = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const nextMonth = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  const goToday = () => setCursor(new Date(today.getFullYear(), today.getMonth(), 1));

  // Bottom sheet móvil con el detalle de un día (mensual, anual y orbe "Hoy")
  const [daySheet, setDaySheet] = useState(null); // date iso o null
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

  // Orbe "Hoy" del dock móvil: vuelve a hoy y abre la pantalla de hoy
  const [todayTick, setTodayTick] = useState(0);
  const [todayOpen, setTodayOpen] = useState(false);
  const handleGoToday = () => {
    goToday();
    setSelectedDay(iso(today));
    setTodayTick(t => t + 1); // resetea la semana en WeeklyView
    setTodayOpen(true);
  };
  const handleDayClick = (dateIso) => {
    setSelectedDay(dateIso);
    // En móvil el detalle del día se abre como bottom sheet
    if (isMobile()) setDaySheet(dateIso);
  };

  const handleLaborChange = async (date, type) => {
    if (type === null) await api.clearLabor(date);
    else await api.setLabor(date, { type });
    reloadLabor();
  };

  const jumpToMonth = (date) => {
    setCursor(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const exportMonthWorkToExcel = useCallback(() => {
    const run = async () => {
      const XLSX = await import('xlsx');
      const sortedEntries = [...monthWorkEntries].sort((left, right) => {
        const byDate = left.date.localeCompare(right.date);
        if (byDate !== 0) return byDate;

        const leftProject = left.project_name || 'Sin proyecto';
        const rightProject = right.project_name || 'Sin proyecto';
        const byProject = leftProject.localeCompare(rightProject, 'es', { sensitivity: 'base' });
        if (byProject !== 0) return byProject;

        return (left.id || 0) - (right.id || 0);
      });

      const rows = sortedEntries.map((entry) => {
        const date = new Date(`${entry.date}T00:00:00`);
        return {
          Fecha: entry.date,
          Dia: date.toLocaleDateString('es-ES', { weekday: 'long' }),
          Proyecto: entry.project_name || 'Sin proyecto',
          Horas: Number(entry.hours || 0),
          Nota: entry.note || '',
        };
      });

      const totalHours = rows.reduce((sum, row) => sum + row.Horas, 0);
      rows.push({
        Fecha: '',
        Dia: '',
        Proyecto: 'TOTAL',
        Horas: Number(totalHours.toFixed(2)),
        Nota: '',
      });

      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet['!cols'] = [
        { wch: 12 },
        { wch: 14 },
        { wch: 28 },
        { wch: 10 },
        { wch: 48 },
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Trabajo mensual');

      const monthLabel = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      XLSX.writeFile(workbook, `trabajo-${monthLabel}.xlsx`);
    };

    run();
  }, [cursor, monthWorkEntries]);

  const handleCalendarTabChange = (id) => {
    setView(id);
    setCalendarTab(id);
  };

  const handleMobileViewChange = (id) => {
    setTodayOpen(false);
    setView(id === 'monthly' ? calendarTab : id);
  };

  const calendarTabs = [
    {
      id: 'weekly',
      label: 'Semana',
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm0 4h14M7 3v4m6-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: 'monthly',
      label: 'Mes',
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm0 4h14M7 3v4m6-4v4M6.5 12h1m3 0h1m3 0h1M6.5 14.5h1m3 0h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      id: 'annual',
      label: 'Año',
      icon: (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8h14M7 4V2.5m6 1.5V2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="11.5" r="0.75" fill="currentColor" />
          <circle cx="10" cy="11.5" r="0.75" fill="currentColor" />
          <circle cx="13" cy="11.5" r="0.75" fill="currentColor" />
          <circle cx="7" cy="14" r="0.75" fill="currentColor" />
          <circle cx="10" cy="14" r="0.75" fill="currentColor" />
        </svg>
      ),
    },
  ];

  const viewOrder = ['calendar', 'projects', 'notes'];
  const isCalendarView = view !== 'projects' && view !== 'notes';
  const handleViewTabKeyDown = (e, currentView) => {
    const currentIndex = viewOrder.indexOf(currentView);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % viewOrder.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + viewOrder.length) % viewOrder.length;
    } else if (e.key === 'Home') {
      nextIndex = 0;
    } else if (e.key === 'End') {
      nextIndex = viewOrder.length - 1;
    } else {
      return;
    }

    e.preventDefault();
    const nextView = viewOrder[nextIndex];
    if (nextView === 'calendar') {
      setView(calendarTab);
    } else {
      setView(nextView);
    }
    requestAnimationFrame(() => {
      document.getElementById(`view-tab-${nextView}`)?.focus();
    });
  };

  // Ctrl+K / Cmd+K abre la paleta de comandos
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const jumpToDate = useCallback((date) => {
    setCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    setSelectedDay(iso(date));
    setView('monthly');
    setCalendarTab('monthly');
  }, []);
  const paletteCommands = [
    { id: 'go-week', label: 'Ir a Semana', keywords: 'calendario semanal', hint: 'Vista', run: () => handleCalendarTabChange('weekly') },
    { id: 'go-month', label: 'Ir a Mes', keywords: 'calendario mensual', hint: 'Vista', run: () => handleCalendarTabChange('monthly') },
    { id: 'go-year', label: 'Ir a Año', keywords: 'calendario anual vacaciones festivos', hint: 'Vista', run: () => handleCalendarTabChange('annual') },
    { id: 'go-projects', label: 'Ir a Proyectos', keywords: 'horas', hint: 'Vista', run: () => setView('projects') },
    { id: 'go-notes', label: 'Ir a Notas', keywords: 'actas word markdown', hint: 'Vista', run: () => setView('notes') },
    { id: 'go-today', label: 'Ir a hoy', keywords: 'fecha actual', hint: 'Fecha', run: () => jumpToDate(today) },
    { id: 'export-excel', label: 'Exportar el mes a Excel', keywords: 'xlsx horas descargar', hint: 'Acción', run: () => exportMonthWorkToExcel() },
    { id: 'theme-dark', label: 'Tema oscuro', keywords: 'modo noche', hint: 'Tema', run: () => { setThemePref('dark'); setTheme('dark'); } },
    { id: 'theme-light', label: 'Tema claro', keywords: 'modo dia', hint: 'Tema', run: () => { setThemePref('light'); setTheme('light'); } },
    { id: 'theme-auto', label: 'Tema según el sistema', keywords: 'automatico', hint: 'Tema', run: () => { setThemePref('auto'); setTheme('auto'); } },
    ...(onLogout ? [{ id: 'logout', label: 'Cerrar sesión', keywords: 'salir', hint: 'Cuenta', run: onLogout }] : []),
  ];

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      {apiOffline && (
        <div className="api-offline-banner" role="alert">
          <span className="api-offline-dot" aria-hidden="true" />
          Sin conexión con el servidor — reintentando…
        </div>
      )}
      <aside className="sidebar">
        {sidebarOpen ? (
          <div className="sidebar-inner">
            <div className="sidebar-head">
              <div>
                <div className="side-title">Agenda</div>
                <div className="side-sub">{cursor.getFullYear()} · Madrid</div>
              </div>
              <button className="btn btn-icon dark" onClick={() => setSidebarOpen(false)} title="Ocultar" aria-label="Ocultar barra lateral">‹</button>
            </div>

            <div className="side-tabs" role="tablist" aria-label="Vistas de agenda" aria-orientation="vertical">
              <button
                id="view-tab-calendar"
                role="tab"
                aria-selected={isCalendarView}
                aria-controls="view-panel-calendar"
                tabIndex={isCalendarView ? 0 : -1}
                className={`side-tab ${isCalendarView ? 'active' : ''}`}
                onClick={() => setView(calendarTab)}
                onKeyDown={(e) => handleViewTabKeyDown(e, 'calendar')}
              >
                <svg className="side-tab-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm0 4h14M7 3v4m6-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Calendario</span>
              </button>
              <button
                id="view-tab-projects"
                role="tab"
                aria-selected={view === 'projects'}
                aria-controls="view-panel-projects"
                tabIndex={view === 'projects' ? 0 : -1}
                className={`side-tab ${view === 'projects' ? 'active' : ''}`}
                onClick={() => setView('projects')}
                onKeyDown={(e) => handleViewTabKeyDown(e, 'projects')}
              >
                <svg className="side-tab-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M2.5 6.5a2 2 0 0 1 2-2h2.7l1.8 2H15.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
                <span>Proyectos</span>
              </button>
              <button
                id="view-tab-notes"
                role="tab"
                aria-selected={view === 'notes'}
                aria-controls="view-panel-notes"
                tabIndex={view === 'notes' ? 0 : -1}
                className={`side-tab ${view === 'notes' ? 'active' : ''}`}
                onClick={() => setView('notes')}
                onKeyDown={(e) => handleViewTabKeyDown(e, 'notes')}
              >
                <svg className="side-tab-icon" aria-hidden="true" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 3h7l4 4v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 16V4.5A1.5 1.5 0 0 1 5.5 3M12 3v4h4M7 10.5h6M7 13.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Notas</span>
              </button>
            </div>

            {/* Sidebar content per calendar sub-view */}
            {view === 'monthly' && (
              <LaborSidebar />
            )}
            {view === 'annual' && (
              <div className="sidebar-section">
                <div className="vac-card">
                  <div className="vac-head">
                    <div>
                      <div className="vac-title">Vacaciones</div>
                      <div className="vac-sub">{vacationUsed} usados · <b>{vacationTotal - vacationUsed}</b> restantes</div>
                    </div>
                    <input
                      type="number" min="0" max="60"
                      value={vacationTotal}
                      onChange={async e => { await api.setSetting('vacation_total', e.target.value); reloadSettings(); }}
                      className="vac-total-input"
                      title="Total días de vacaciones"
                    />
                  </div>
                  <div className="vac-bar">
                    <div className="vac-bar-fill" style={{ width: `${vacationTotal > 0 ? Math.min(100, (vacationUsed / vacationTotal) * 100) : 0}%` }} />
                  </div>
                </div>
                <div className="legend">
                  <div className="legend-title">Pincel · pulsa para aplicar</div>
                  {LABOR_ORDER.filter(t => t !== 'laborable' && t !== 'finde').map(t => (
                    <button key={t}
                      className={`legend-item ${activeType === t ? 'active' : ''}`}
                      onClick={() => setActiveType(t)}>
                      <span className="legend-swatch" style={{ background: LABOR_TYPES[t].color, borderColor: LABOR_TYPES[t].text }} />
                      <span>{LABOR_TYPES[t].label}</span>
                    </button>
                  ))}
                  <div className="legend-hint">Pulsa de nuevo para borrar.</div>
                </div>
              </div>
            )}
            {view === 'projects' && (
              <div className="sidebar-section">
                <div className="side-projects-info">
                  <div className="ws-section-title">Proyectos</div>
                  <p className="ws-hint">{projects.length} proyecto{projects.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
            )}
            <div className="side-foot">
              <button type="button" className="side-shortcut" onClick={() => setPaletteOpen(true)}>
                <span>Buscar o ejecutar…</span>
                <kbd>Ctrl K</kbd>
              </button>
              <div className="theme-switch">
                <span id="theme-switch-label">Tema</span>
                <div className="theme-switch-group" role="group" aria-labelledby="theme-switch-label">
                  {[['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className="theme-switch-btn"
                      aria-pressed={theme === id}
                      onClick={() => { setThemePref(id); setTheme(id); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {onLogout && (
                <button type="button" className="side-logout" onClick={onLogout}>Cerrar sesión</button>
              )}
            </div>
          </div>
        ) : (
          <div className="sidebar-collapsed-inner">
            <button className="btn btn-icon dark" onClick={() => setSidebarOpen(true)} title="Mostrar" aria-label="Mostrar barra lateral">›</button>
          </div>
        )}
      </aside>

      <main className="main">
        {/* ---- Calendar panel (FluidTabs + sub-views) ---- */}
        {isCalendarView && (
          <section
            className="calendar-panel"
            id="view-panel-calendar"
            role="tabpanel"
            aria-labelledby="view-tab-calendar"
          >
            <div className="calendar-view-tabs">
              <FluidTabs
                tabs={calendarTabs}
                active={calendarTab}
                onChange={handleCalendarTabChange}
              />
            </div>

            {/* Weekly */}
            {view === 'weekly' && (
              <WeeklyView
                today={today}
                onReload={reloadMonth}
                laborMap={laborMap}
                projects={activeProjects}
                resetSignal={todayTick}
              />
            )}

            {/* Monthly */}
            {view === 'monthly' && (
              <section aria-label="Vista mensual">
            <section className="toolbar">
              <div className="month-nav">
                <button className="btn btn-icon" onClick={prevMonth} aria-label="Anterior">‹</button>
                <h1 className="month-title">
                  {MONTH_NAMES[cursor.getMonth()]} <span>{cursor.getFullYear()}</span>
                </h1>
                <button className="btn btn-icon" onClick={nextMonth} aria-label="Siguiente">›</button>
                <button className="btn btn-ghost" onClick={goToday}>Hoy</button>
              </div>
              <div className="toolbar-actions">
                <button
                  className="btn btn-primary excel-export-btn"
                  onClick={exportMonthWorkToExcel}
                  disabled={monthWorkEntries.length === 0}
                  aria-label="Exportar trabajos a Excel"
                  title="Exportar trabajos a Excel"
                >
                  <svg
                    className="excel-export-icon"
                    viewBox="0 0 64 64"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <defs>
                      <linearGradient id="excelSheet" x1="0%" x2="100%" y1="0%" y2="100%">
                        <stop offset="0%" stopColor="#34d399" />
                        <stop offset="100%" stopColor="#15803d" />
                      </linearGradient>
                      <linearGradient id="excelPanel" x1="0%" x2="100%" y1="0%" y2="100%">
                        <stop offset="0%" stopColor="#166534" />
                        <stop offset="100%" stopColor="#14532d" />
                      </linearGradient>
                    </defs>
                    <path d="M22 8h26a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H22z" fill="url(#excelSheet)" />
                    <path d="M22 8h12v48H22z" fill="#bbf7d0" opacity="0.35" />
                    <path d="M16 14h18a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" fill="url(#excelPanel)" />
                    <path d="M24.7 22 19 31l5.7 9h-4.8L16.6 34l-3.4 6h-4.5l5.7-9-5.4-9h4.7l3.2 5.8 3.2-5.8z" fill="#f0fdf4" />
                    <path d="M38 20h11M38 28h11M38 36h11M38 44h11" stroke="#ecfdf5" strokeWidth="2.4" strokeLinecap="round" opacity="0.9" />
                  </svg>
                </button>
              </div>
            </section>
            <div className="monthly-layout">
              <div className="monthly-left">
                <Calendar
                  cursor={cursor}
                  today={today}
                  onSelect={handleDayClick}
                  laborMap={laborMap}
                  daySummaries={daySummaries}
                  selectedDay={selectedDay}
                  onDropTodo={async (todoId, dateIso) => {
                    await api.updateTodo(todoId, { date: dateIso });
                    reloadMonth();
                  }}
                />
              </div>
              <div className="monthly-right">
                <DayDetailPanel
                  key={selectedDay}
                  date={selectedDay}
                  laborMap={laborMap}
                  projects={activeProjects}
                  onReload={reloadMonth}
                />
              </div>
            </div>
          </section>
        )}

            {/* Annual */}
            {view === 'annual' && (
              <section aria-label="Vista anual">
            <section className="toolbar">
              <div className="month-nav">
                <button className="btn btn-icon" onClick={() => setCursor(new Date(cursor.getFullYear() - 1, 0, 1))} aria-label="Año anterior">‹</button>
                <h1 className="month-title">
                  {cursor.getFullYear()}
                </h1>
                <button className="btn btn-icon" onClick={() => setCursor(new Date(cursor.getFullYear() + 1, 0, 1))} aria-label="Año siguiente">›</button>
                <button className="btn btn-ghost" onClick={goToday}>Hoy</button>
              </div>
            </section>
            {/* Herramientas táctiles (solo móvil): vacaciones + pincel en chips */}
            <div className="mobile-annual-tools">
              <div className="mat-vac">
                <span>🏖️ <b>{vacationTotal - vacationUsed}</b> días restantes</span>
                <div className="mat-vac-bar">
                  <div className="mat-vac-fill" style={{ width: `${vacationTotal > 0 ? Math.min(100, (vacationUsed / vacationTotal) * 100) : 0}%` }} />
                </div>
              </div>
              <div className="mat-brushes" role="radiogroup" aria-label="Pincel de tipo de día">
                {LABOR_ORDER.filter(t => t !== 'laborable' && t !== 'finde').map(t => (
                  <button
                    key={t}
                    role="radio"
                    aria-checked={activeType === t}
                    className={`mat-brush ${activeType === t ? 'active' : ''}`}
                    onClick={() => setActiveType(t)}
                  >
                    <span className="mat-brush-swatch" style={{ background: LABOR_TYPES[t].color }} />
                    {LABOR_TYPES[t].label}
                  </button>
                ))}
              </div>
            </div>
            <Suspense fallback={<div className="panel-loader">Cargando vista anual…</div>}>
              <YearView
                year={cursor.getFullYear()}
                laborMap={laborMap}
                activeType={activeType}
                onChange={handleLaborChange}
                onJump={(d) => { jumpToMonth(d); setView('monthly'); }}
                onDayPeek={(d) => setDaySheet(d)}
                onReload={reloadMonth}
              />
            </Suspense>
              </section>
            )}
          </section>
        )}

        {/* ---- Notes View ---- */}
        {view === 'notes' && (
          <section id="view-panel-notes" role="tabpanel" aria-labelledby="view-tab-notes" aria-label="Notas">
            <Suspense fallback={<div className="panel-loader">Cargando notas…</div>}>
              <NotesPage projects={projects} />
            </Suspense>
          </section>
        )}

        {/* ---- Projects View ---- */}
        {view === 'projects' && (
          <section id="view-panel-projects" role="tabpanel" aria-labelledby="view-tab-projects" aria-label="Vista de proyectos">
            <section className="toolbar">
              <div className="month-nav">
                <button className="btn btn-icon" onClick={prevMonth} aria-label="Anterior">‹</button>
                <h1 className="month-title">
                  {MONTH_NAMES[cursor.getMonth()]} <span>{cursor.getFullYear()}</span>
                </h1>
                <button className="btn btn-icon" onClick={nextMonth} aria-label="Siguiente">›</button>
                <button className="btn btn-ghost" onClick={goToday}>Hoy</button>
              </div>
            </section>
            <Suspense fallback={<div className="panel-loader">Cargando proyectos…</div>}>
              <ProjectsPage
                projects={projects}
                stats={projectStats}
                cursor={cursor}
                laborMap={laborMap}
                reload={async () => { await reloadProjects(); await reloadMonth(); }}
                onUpdateExpected={async (id, hours) => {
                  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
                  await api.setMonthHours(id, monthKey, hours);
                  reloadMonth();
                  reloadProjects();
                }}
              />
            </Suspense>
          </section>
        )}
      </main>
      <MobileNav view={todayOpen ? 'today' : view} onChangeView={handleMobileViewChange} onToday={handleGoToday} todayDate={today} />
      {daySheet && (
        <DaySheet
          date={daySheet}
          laborMap={laborMap}
          projects={activeProjects}
          onReload={reloadMonth}
          onClose={() => { setDaySheet(null); handleCalendarTabChange('weekly'); }}
        />
      )}
      {todayOpen && (
        <TodayScreen
          today={today}
          laborMap={laborMap}
          projects={activeProjects}
          onReload={reloadMonth}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        commands={paletteCommands}
        today={today}
        onJumpToDate={jumpToDate}
        onTaskCreated={reloadMonth}
      />
      {/* DESACTIVADO (no eliminar): PixelAgent (agente IA gemma)
      {showPixelAgent && (
        <Suspense fallback={null}>
          <PixelAgent />
        </Suspense>
      )}
      */}
    </div>
  );
}
