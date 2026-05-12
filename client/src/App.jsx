import { useEffect, useMemo, useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { api } from './api.js';
import { MONTH_NAMES, iso } from './utils.js';
import Calendar from './components/Calendar.jsx';
import DayDetailPanel from './components/DayDetailPanel.jsx';
import LaborSidebar from './components/LaborSidebar.jsx';
import YearView from './components/YearView.jsx';
import ProjectsPage from './components/ProjectsPage.jsx';
import WeeklyView from './components/WeeklyView.jsx';
import { LABOR_TYPES, LABOR_ORDER } from './utils.js';

export default function App() {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(iso(today));
  const [view, setView] = useState('weekly'); // 'weekly' | 'monthly' | 'annual' | 'projects'
  const [activeType, setActiveType] = useState('vacaciones');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [projects, setProjects] = useState([]);
  const [projectStats, setProjectStats] = useState([]);
  const [monthWorkEntries, setMonthWorkEntries] = useState([]);
  const [laborMap, setLaborMap] = useState({});
  const [daySummaries, setDaySummaries] = useState({});
  const [settings, setSettings] = useState({ vacation_total: '23' });

  const reloadProjects = useCallback(async () => setProjects(await api.listProjects()), []);
  const reloadSettings = useCallback(async () => setSettings(await api.getSettings()), []);

  const reloadLabor = useCallback(async () => {
    const year = cursor.getFullYear();
    const rows = await api.listLabor(`${year}-01-01`, `${year}-12-31`);
    const map = {};
    rows.forEach(r => { map[r.date] = r; });
    setLaborMap(map);
  }, [cursor]);

  const reloadMonth = useCallback(async () => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const from = iso(new Date(y, m, 1));
    const to = iso(new Date(y, m + 1, 0));
    const [work, events, todos, stats, meetings] = await Promise.all([
      api.listWork({ from, to }),
      api.listEvents({ from, to }),
      api.listTodos({ from, to }),
      api.projectStats(),
      api.listMeetings({ from, to }).catch(() => []),
    ]);
    const map = {};
    const ensure = (date) => (map[date] ||= { work: [], events: [], todos: [], meetings: [] });
    work.forEach(w => ensure(w.date).work.push(w));
    events.forEach(e => ensure(e.date).events.push(e));
    todos.forEach(t => ensure(t.date).todos.push(t));
    meetings.forEach(mt => ensure(mt.date).meetings.push(mt));
    setMonthWorkEntries(work);
    setDaySummaries(map);
    setProjectStats(stats);
  }, [cursor]);

  useEffect(() => { reloadProjects(); reloadSettings(); }, [reloadProjects, reloadSettings]);
  useEffect(() => { reloadLabor(); reloadMonth(); }, [reloadLabor, reloadMonth]);

  useEffect(() => {
    const id = setInterval(() => {
      api.refreshMeetings().then(() => reloadMonth()).catch(() => {});
    }, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [reloadMonth]);

  const vacationTotal = parseInt(settings.vacation_total || '23', 10);
  const vacationUsed = useMemo(
    () => Object.values(laborMap).filter(d => d.type === 'vacaciones').length,
    [laborMap]
  );

  const prevMonth = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const nextMonth = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  const goToday = () => setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
  const handleDayClick = (dateIso) => setSelectedDay(dateIso);

  const handleLaborChange = async (date, type) => {
    if (type === null) await api.clearLabor(date);
    else await api.setLabor(date, { type });
    reloadLabor();
  };

  const jumpToMonth = (date) => {
    setCursor(new Date(date.getFullYear(), date.getMonth(), 1));
  };

  const exportMonthWorkToExcel = useCallback(() => {
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
  }, [cursor, monthWorkEntries]);

  return (
    <div className={`app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar">
        {sidebarOpen ? (
          <div className="sidebar-inner">
            <div className="sidebar-head">
              <div>
                <div className="side-title">Agenda</div>
                <div className="side-sub">{cursor.getFullYear()} · Madrid</div>
              </div>
              <button className="btn btn-icon dark" onClick={() => setSidebarOpen(false)} title="Ocultar">‹</button>
            </div>

            <div className="side-tabs">
              <button className={`side-tab ${view === 'weekly' ? 'active' : ''}`} onClick={() => setView('weekly')}>
                Semanal
              </button>
              <button className={`side-tab ${view === 'monthly' ? 'active' : ''}`} onClick={() => setView('monthly')}>
                Mensual
              </button>
              <button className={`side-tab ${view === 'annual' ? 'active' : ''}`} onClick={() => setView('annual')}>
                Anual
              </button>
              <button className={`side-tab ${view === 'projects' ? 'active' : ''}`} onClick={() => setView('projects')}>
                Proyectos
              </button>
            </div>

            {/* Sidebar content per view */}
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
                      onChange={e => { api.setSetting('vacation_total', e.target.value); reloadSettings(); }}
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
            <button className="btn btn-icon dark" onClick={() => setSidebarOpen(true)} title="Mostrar">›</button>
          </div>
        )}
      </aside>

      <main className="main">
        {/* ---- Weekly View ---- */}
        {view === 'weekly' && (
          <WeeklyView
            today={today}
            onReload={reloadMonth}
            laborMap={laborMap}
          />
        )}

        {/* ---- Monthly View ---- */}
        {view === 'monthly' && (
          <>
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
                  projects={projects}
                  onReload={reloadMonth}
                />
              </div>
            </div>
          </>
        )}

        {/* ---- Annual View ---- */}
        {view === 'annual' && (
          <>
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
            <YearView
              year={cursor.getFullYear()}
              laborMap={laborMap}
              activeType={activeType}
              onChange={handleLaborChange}
              onJump={(d) => { jumpToMonth(d); setView('monthly'); }}
            />
          </>
        )}

        {/* ---- Projects View ---- */}
        {view === 'projects' && (
          <>
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
            <ProjectsPage
              projects={projects}
              stats={projectStats}
              cursor={cursor}
              reload={async () => { await reloadProjects(); await reloadMonth(); }}
              onUpdateExpected={async (id, hours) => {
                const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
                await api.setMonthHours(id, monthKey, hours);
                reloadMonth();
                reloadProjects();
              }}
            />
          </>
        )}
      </main>
    </div>
  );
}
