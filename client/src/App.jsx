import { lazy, Suspense, useEffect, useMemo, useState, useCallback } from 'react';
import { api } from './api.js';
import { MONTH_NAMES, iso } from './utils.js';
import Calendar from './components/Calendar.jsx';
import DayDetailPanel from './components/DayDetailPanel.jsx';
import LaborSidebar from './components/LaborSidebar.jsx';
import WeeklyView from './components/WeeklyView.jsx';
import MobileNav from './components/MobileNav.jsx';
import DaySheet from './components/DaySheet.jsx';
import TodayScreen from './components/TodayScreen.jsx';
import { FluidTabs } from './components/FluidTabs.jsx';
import { LABOR_TYPES, LABOR_ORDER } from './utils.js';

const YearView = lazy(() => import('./components/YearView.jsx'));
const ProjectsPage = lazy(() => import('./components/ProjectsPage.jsx'));
// DESACTIVADO (no eliminar): PixelAgent (agente IA gemma)
// const PixelAgent = lazy(() => import('./components/PixelAgent.jsx'));

export default function App() {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(iso(today));
  const [view, setView] = useState('weekly'); // 'weekly' | 'monthly' | 'annual' | 'projects'
  const [calendarTab, setCalendarTab] = useState('weekly'); // última sub-vista de calendario activa
  const [activeType, setActiveType] = useState('vacaciones');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // DESACTIVADO (no eliminar): estado del PixelAgent (agente IA gemma)
  // const [showPixelAgent, setShowPixelAgent] = useState(false);

  const [apiOffline, setApiOffline] = useState(false);

  const [projects, setProjects] = useState([]);
  const [projectStats, setProjectStats] = useState([]);
  const [monthWorkEntries, setMonthWorkEntries] = useState([]);
  const [laborMap, setLaborMap] = useState({});
  const [daySummaries, setDaySummaries] = useState({});
  const [settings, setSettings] = useState({ vacation_total: '23' });

  const reloadProjects = useCallback(async () => {
    try {
      const list = await api.listProjects();
      setProjects(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Error cargando proyectos:', err);
      setProjects([]);
    }
  }, []);
  // proyectos hibernados no deben ofrecerse al registrar horas/reuniones
  const activeProjects = useMemo(() => projects.filter(p => p.is_active !== 0), [projects]);
  const reloadSettings = useCallback(async () => {
    try {
      const s = await api.getSettings();
      setSettings(s && typeof s === 'object' ? s : { vacation_total: '23' });
    } catch (err) {
      console.error('Error cargando ajustes:', err);
      setSettings({ vacation_total: '23' });
    }
  }, []);

  const reloadLabor = useCallback(async () => {
    try {
      const year = cursor.getFullYear();
      const rows = await api.listLabor(`${year}-01-01`, `${year}-12-31`);
      const map = {};
      (rows || []).forEach(r => { if (r && r.date) map[r.date] = r; });
      setLaborMap(map);
    } catch (err) {
      console.error('Error cargando jornada laboral:', err);
      setLaborMap({});
    }
  }, [cursor]);

  const reloadMonth = useCallback(async () => {
    try {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const from = iso(new Date(y, m, 1));
      const to = iso(new Date(y, m + 1, 0));
      const [work, events, todos, stats, meetings] = await Promise.all([
        api.listWork({ from, to }).catch(() => []),
        api.listEvents({ from, to }).catch(() => []),
        api.listTodos({ from, to }).catch(() => []),
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
      setMonthWorkEntries(Array.isArray(work) ? work : []);
      setDaySummaries(map);
      setProjectStats(Array.isArray(stats) ? stats : []);
    } catch (err) {
      console.error('Error cargando datos del mes:', err);
      setMonthWorkEntries([]);
      setDaySummaries({});
      setProjectStats([]);
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

  const viewOrder = ['calendar', 'projects'];
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
                aria-selected={view !== 'projects'}
                aria-controls="view-panel-calendar"
                tabIndex={view !== 'projects' ? 0 : -1}
                className={`side-tab ${view !== 'projects' ? 'active' : ''}`}
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
          </div>
        ) : (
          <div className="sidebar-collapsed-inner">
            <button className="btn btn-icon dark" onClick={() => setSidebarOpen(true)} title="Mostrar" aria-label="Mostrar barra lateral">›</button>
          </div>
        )}
      </aside>

      <main className="main">
        {/* ---- Calendar panel (FluidTabs + sub-views) ---- */}
        {view !== 'projects' && (
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
