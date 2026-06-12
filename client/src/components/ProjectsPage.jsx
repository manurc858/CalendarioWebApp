import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api.js';
import { MONTH_NAMES, iso, fmtHours, calcMeetingHours, availableWorkHoursForMonth } from '../utils.js';
import FlowbiteDropdown from './FlowbiteDropdown.jsx';

const COLORS = ['#a78bfa', '#86efac', '#fbbf24', '#f87171', '#60a5fa', '#34d399', '#f472b6', '#38bdf8'];

export default function ProjectsPage({ projects, stats, cursor, laborMap, reload, onUpdateExpected }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null); // project id or 'none'
  const [sortMode, setSortMode] = useState('alert');
  const [editingExpected, setEditingExpected] = useState(null);
  const [expectedVal, setExpectedVal] = useState('');
  const [descVal, setDescVal] = useState('');
  const [linksVal, setLinksVal] = useState('');
  const [newLink, setNewLink] = useState('');
  const [editingWorkId, setEditingWorkId] = useState(null);
  const [editWorkHours, setEditWorkHours] = useState('');
  const [editWorkProjectId, setEditWorkProjectId] = useState('');
  const [editWorkNote, setEditWorkNote] = useState('');
  const [openWorkNoteId, setOpenWorkNoteId] = useState(null);
  const [showEntries, setShowEntries] = useState(true);
  const [showMeetings, setShowMeetings] = useState(true);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const from = iso(new Date(year, month, 1));
  const to = iso(new Date(year, month + 1, 0));

  const [monthWork, setMonthWork] = useState([]);
  const [monthMeetings, setMonthMeetings] = useState([]);
  const loadMonthWork = useCallback(async () => {
    const [entries, meetings] = await Promise.all([
      api.listWork({ from, to }),
      api.listMeetings({ from, to }).catch(() => []),
    ]);
    setMonthWork(entries);
    setMonthMeetings(meetings);
  }, [from, to]);

  useEffect(() => { loadMonthWork(); }, [loadMonthWork]);

  useEffect(() => {
    setOpenWorkNoteId(null);
    setShowEntries(true);
    setShowMeetings(true);
  }, [selected, cursor]);

  const toggleWorkNote = (workId) => {
    setOpenWorkNoteId(prev => (prev === workId ? null : workId));
  };

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api.createProject({ name: name.trim(), color });
    setName('');
    setColor(COLORS[0]);
    setShowForm(false);
    reload();
  };

  const del = async (id, projectName) => {
    if (!confirm(`¿Eliminar proyecto "${projectName}"?`)) return;
    await api.deleteProject(id);
    if (selected === id) setSelected(null);
    reload();
    loadMonthWork();
  };

  const unassignedWork = monthWork.filter(w => !w.project_id);

  const projectInsights = useMemo(() => {
    return projects.map((p) => {
      const projectEntries = monthWork.filter(w => w.project_id === p.id);
      const projectMeetings = monthMeetings.filter(m => m.project_id === p.id);
      const totalHours = projectEntries.reduce((sum, work) => sum + (work.hours || 0), 0);
      const meetingHours = calcMeetingHours(projectMeetings);
      const workedHours = totalHours + meetingHours;
      const stat = stats.find(s => s.id === p.id);
      const expectedHours = stat?.expected_hours_month || 0;
      const progressPct = expectedHours > 0 ? Math.min(100, (workedHours / expectedHours) * 100) : 0;
      const balance = workedHours - expectedHours;
      const activityDates = [
        ...projectEntries.map(work => work.date),
        ...projectMeetings.map(meeting => meeting.date),
      ];
      const lastActivity = activityDates.reduce((latest, current) => (current > latest ? current : latest), '');
      const hasActivity = activityDates.length > 0;
      const statusKey = !hasActivity
        ? 'inactive'
        : expectedHours > 0 && balance > 0
          ? 'overload'
          : expectedHours > 0 && progressPct >= 85
            ? 'warning'
            : 'ok';
      const statusLabel = statusKey === 'inactive'
        ? 'Sin actividad'
        : statusKey === 'overload'
          ? 'Sobrecarga'
          : statusKey === 'warning'
            ? 'Cerca del límite'
            : 'En ritmo';

      return {
        ...p,
        totalHours,
        meetingHours,
        workedHours,
        expectedHours,
        progressPct,
        balance,
        hasActivity,
        lastActivity,
        statusKey,
        statusLabel,
      };
    });
  }, [projects, monthWork, monthMeetings, stats]);

  const projectById = useMemo(() => new Map(projectInsights.map(item => [item.id, item])), [projectInsights]);

  const totalWorkedHours = useMemo(
    () => monthWork.reduce((sum, work) => sum + (work.hours || 0), 0) + calcMeetingHours(monthMeetings),
    [monthWork, monthMeetings]
  );

  const totalExpectedHours = useMemo(
    () => projectInsights.reduce((sum, project) => sum + (project.expectedHours || 0), 0),
    [projectInsights]
  );

  const availableMonthHours = useMemo(
    () => availableWorkHoursForMonth(year, month, laborMap || {}),
    [year, month, laborMap]
  );

  const dashboardKpis = useMemo(() => {
    const overloadedCount = projectInsights.filter(project => project.statusKey === 'overload').length;
    const inactiveCount = projectInsights.filter(project => project.statusKey === 'inactive').length;
    const warningCount = projectInsights.filter(project => project.statusKey === 'warning').length;
    const unassignedHours = unassignedWork.reduce((sum, work) => sum + (work.hours || 0), 0);
    const deviationHours = totalWorkedHours - availableMonthHours;
    const coveragePct = availableMonthHours > 0 ? Math.min(999, (totalWorkedHours / availableMonthHours) * 100) : 0;

    return {
      overloadedCount,
      inactiveCount,
      warningCount,
      unassignedHours,
      deviationHours,
      coveragePct,
    };
  }, [projectInsights, unassignedWork, totalWorkedHours, availableMonthHours]);

  const visibleProjects = useMemo(() => {
    const sorted = [...projectInsights];

    sorted.sort((a, b) => {
      if (sortMode === 'hours') {
        return b.workedHours - a.workedHours || a.name.localeCompare(b.name, 'es');
      }

      if (sortMode === 'name') {
        return a.name.localeCompare(b.name, 'es');
      }

      const rank = (project) => {
        if (project.statusKey === 'overload') return 0;
        if (project.statusKey === 'warning') return 1;
        if (project.statusKey === 'inactive') return 2;
        return 3;
      };

      return rank(a) - rank(b) || b.workedHours - a.workedHours || a.name.localeCompare(b.name, 'es');
    });

    return sorted;
  }, [projectInsights, sortMode]);

  const totalHoursForProject = (pid) =>
    monthWork.filter(w => w.project_id === pid).reduce((s, w) => s + (w.hours || 0), 0);

  const meetingHoursForProject = (pid) =>
    calcMeetingHours(monthMeetings.filter(m => m.project_id === pid));

  const totalForProject = (pid) => totalHoursForProject(pid) + meetingHoursForProject(pid);

  // Entries for the selected project
  const selectedEntries = selected === 'none'
    ? unassignedWork
    : selected != null ? monthWork.filter(w => w.project_id === selected) : [];

  const selectedMeetings = selected != null && selected !== 'none'
    ? monthMeetings.filter(m => m.project_id === selected) : [];

  const selectedProject = selected === 'none'
    ? { name: 'Sin proyecto', color: '#ccc' }
    : projects.find(p => p.id === selected);

  const selectedInsight = selected !== 'none' ? projectById.get(selected) : null;
  const selectedStat = selected !== 'none' ? stats.find(s => s.id === selected) : null;
  const selectedExpected = selectedInsight?.expectedHours ?? (selectedStat?.expected_hours_month || 0);
  const selectedTotal = selectedEntries.reduce((s, w) => s + (w.hours || 0), 0) + calcMeetingHours(selectedMeetings);
  const selectedProgress = selectedExpected > 0 ? Math.min(100, (selectedTotal / selectedExpected) * 100) : 0;
  const selectedBalance = selectedTotal - selectedExpected;
  const selectedLastActivity = selectedInsight?.lastActivity || null;

  // Sync description/links when selection changes
  useEffect(() => {
    if (selected && selected !== 'none') {
      const p = projects.find(pr => pr.id === selected);
      setDescVal(p?.description || '');
      setLinksVal(p?.links || '');
    } else {
      setDescVal('');
      setLinksVal('');
    }
  }, [selected, projects]);

  const saveField = async (field, value) => {
    if (selected && selected !== 'none') {
      await api.updateProject(selected, { [field]: value });
      reload();
    }
  };

  const startEditWork = (work) => {
    setEditingWorkId(work.id);
    setEditWorkHours(String(work.hours || 0));
    setEditWorkProjectId(work.project_id ? String(work.project_id) : '');
    setEditWorkNote(work.note || '');
    setOpenWorkNoteId(null);
  };

  const cancelEditWork = () => {
    setEditingWorkId(null);
    setEditWorkHours('');
    setEditWorkProjectId('');
    setEditWorkNote('');
  };

  const saveEditWork = async (id) => {
    const parsedHours = parseFloat(editWorkHours);
    if (!parsedHours || parsedHours <= 0) return;
    await api.updateWork(id, {
      hours: parsedHours,
      project_id: editWorkProjectId ? Number(editWorkProjectId) : null,
      note: editWorkNote.trim() || null,
    });
    cancelEditWork();
    loadMonthWork();
    reload();
  };

  const formatShortDate = (dateStr) => {
    if (!dateStr) return 'sin actividad';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
    });
  };

  const selectedLoadState = selected === 'none'
    ? 'Sin proyecto'
    : projectById.get(selected)?.statusLabel || 'En ritmo';

  return (
    <div className={`proj-layout ${selected != null ? 'has-selection' : ''}`}>
      {/* LEFT: project list */}
      <div className="proj-left">
        {/* Create form */}
        <div className="proj-create-bar">
          {showForm ? (
            <form className="proj-create-form" onSubmit={add}>
              <input
                type="text" placeholder="Nombre del proyecto"
                value={name} onChange={e => setName(e.target.value)}
                className="inline-input" autoFocus
              />
              <div className="proj-color-row">
                {COLORS.map(c => (
                  <button type="button" key={c}
                    className={`proj-color-dot ${c === color ? 'sel' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)} />
                ))}
              </div>
              <div className="proj-create-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>Crear</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancelar</button>
              </div>
            </form>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(true)}>+ Nuevo proyecto</button>
          )}
        </div>

        {/* Projects with work this month */}
        <div className="proj-filter-bar">
          <FlowbiteDropdown
            className="proj-sort-select"
            value={sortMode}
            onChange={setSortMode}
            options={[
              { value: 'alert', label: 'Ordenar por alerta' },
              { value: 'hours', label: 'Ordenar por horas' },
              { value: 'name', label: 'Ordenar por nombre' },
            ]}
            ariaLabel="Ordenar proyectos"
          />
        </div>

        <div className="proj-list">
          {visibleProjects.length === 0 ? (
            <div className="proj-empty proj-empty-card">
              <strong>No hay proyectos todavía.</strong>
              <span>Crea un proyecto para empezar a registrar horas y ver el resumen aquí.</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Nuevo proyecto</button>
            </div>
          ) : (
            visibleProjects.map(project => {
              const isActive = selected === project.id;
              const percentLabel = project.expectedHours > 0 ? `${project.progressPct.toFixed(0)}%` : '—';

              return (
                <button
                  key={project.id}
                  className={`proj-list-item ${isActive ? 'active' : ''}`}
                  onClick={() => setSelected(isActive ? null : project.id)}
                >
                  <span className="proj-card-dot" style={{ background: project.color }} />
                  <span className="proj-list-main">
                    <span className="proj-list-topline">
                      <span className="proj-list-name">{project.name}</span>
                      <span className={`proj-status-pill is-${project.statusKey}`}>{project.statusLabel}</span>
                    </span>
                    <span className="proj-list-meta">
                      <span className="proj-list-hours">{project.workedHours.toFixed(1)}h</span>
                      {project.expectedHours > 0 && <span className="proj-list-expected">/ {project.expectedHours}h</span>}
                      <span className="proj-list-ratio">{percentLabel}</span>
                      {!project.hasActivity && <span className="proj-list-hint">Sin actividad</span>}
                    </span>
                    <div className="proj-mini-bar" aria-hidden="true">
                      <div
                        className="proj-mini-bar-fill"
                        style={{ width: `${project.progressPct}%`, background: project.color }}
                      />
                    </div>
                  </span>
                </button>
              );
            })
          )}

          {unassignedWork.length > 0 && (
            <button
              className={`proj-list-item proj-list-item--unassigned ${selected === 'none' ? 'active' : ''}`}
              onClick={() => setSelected(selected === 'none' ? null : 'none')}
            >
              <span className="proj-card-dot" style={{ background: '#ccc' }} />
              <span className="proj-list-main">
                <span className="proj-list-topline">
                  <span className="proj-list-name">Sin proyecto</span>
                  <span className="proj-status-pill is-inactive">Pendiente</span>
                </span>
                <span className="proj-list-meta">
                  <span className="proj-list-hours">
                    {unassignedWork.reduce((s, w) => s + (w.hours || 0), 0).toFixed(1)}h
                  </span>
                  <span className="proj-list-hint">Revisar y asignar</span>
                </span>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* RIGHT: detail panel for selected project */}
      <div className="proj-right">
        {/* Volver a la lista (solo móvil, pantalla de detalle) */}
        {selected != null && (
          <button type="button" className="proj-back-btn" onClick={() => setSelected(null)}>
            ‹ Proyectos
          </button>
        )}
        <div className="proj-dashboard">
          <div className="proj-dashboard-head">
            <div>
              <h3 className="proj-dashboard-title">Proyectos · {MONTH_NAMES[month]} {year}</h3>
              <p className="proj-dashboard-sub">
                {totalWorkedHours.toFixed(1)}h registradas · {dashboardKpis.unassignedHours.toFixed(1)}h sin proyecto
              </p>
            </div>
          </div>

          <div className="proj-trend-card">
            <div className="proj-trend-row">
              <span className="proj-trend-label">Cobertura mensual</span>
              <span className="proj-trend-value">
                {availableMonthHours > 0 ? `${dashboardKpis.coveragePct.toFixed(0)}%` : 'Sin objetivo'}
              </span>
            </div>
            <div className="proj-trend-bar" aria-hidden="true">
              <div className="proj-trend-bar-fill" style={{ width: `${Math.min(100, dashboardKpis.coveragePct)}%` }} />
            </div>
            <div className="proj-trend-caption">
              <span>{availableMonthHours > 0 ? `${availableMonthHours.toFixed(2)}h disponibles` : 'No hay horas laborables este mes'}</span>
              <span>{dashboardKpis.deviationHours >= 0 ? '+' : ''}{dashboardKpis.deviationHours.toFixed(1)}h de desviación</span>
            </div>
          </div>

          <div className="proj-kpi-grid">
            <div className="proj-kpi-card">
              <span className="proj-kpi-label">Horas totales</span>
              <strong>{totalWorkedHours.toFixed(1)}h</strong>
              <span className="proj-kpi-sub">Incluye trabajo y reuniones</span>
            </div>
            <div className="proj-kpi-card">
              <span className="proj-kpi-label">Desviación</span>
              <strong className={dashboardKpis.deviationHours > 0 ? 'kpi-up' : dashboardKpis.deviationHours < 0 ? 'kpi-down' : ''}>
                {dashboardKpis.deviationHours >= 0 ? '+' : ''}{dashboardKpis.deviationHours.toFixed(1)}h
              </strong>
              <span className="proj-kpi-sub">Vs. horas laborables del mes</span>
            </div>
            <div className="proj-kpi-card">
              <span className="proj-kpi-label">Sobrecarga</span>
              <strong>{dashboardKpis.overloadedCount}</strong>
              <span className="proj-kpi-sub">Proyectos por encima del objetivo</span>
            </div>
            <div className="proj-kpi-card">
              <span className="proj-kpi-label">Sin actividad</span>
              <strong>{dashboardKpis.inactiveCount}</strong>
              <span className="proj-kpi-sub">Proyectos sin trabajo este mes</span>
            </div>
          </div>

          {selected == null ? (
            <div className="proj-overview proj-card-shell">
              <div className="proj-overview-head">
                <div>
                  <h4 className="proj-overview-title">Resumen ejecutivo</h4>
                  <div className="proj-overview-total">
                    Total: <strong>{totalWorkedHours.toFixed(1)}h</strong>
                  </div>
                </div>
                <div className="proj-overview-meta">
                  <span className="proj-status-pill is-warning">{dashboardKpis.warningCount} cerca del límite</span>
                </div>
              </div>
              <div className="proj-overview-list">
                {projectInsights.map(project => {
                  const percentLabel = project.expectedHours > 0 ? `${project.progressPct.toFixed(0)}%` : '—';
                  return (
                    <button type="button" key={project.id} className="proj-overview-row" onClick={() => setSelected(project.id)}>
                      <span className="proj-card-dot" style={{ background: project.color }} />
                      <span className="proj-overview-main">
                        <span className="proj-overview-line">
                          <span className="proj-overview-name">{project.name}</span>
                          <span className={`proj-status-pill is-${project.statusKey}`}>{project.statusLabel}</span>
                        </span>
                        <span className="proj-overview-line proj-overview-line--subtle">
                          <span className="proj-overview-hours">{project.workedHours.toFixed(1)}h</span>
                          {project.expectedHours > 0 && <span className="proj-overview-exp">/ {project.expectedHours}h</span>}
                          <span className="proj-overview-ratio">{percentLabel}</span>
                          <span className="proj-overview-activity">Última actividad: {formatShortDate(project.lastActivity)}</span>
                        </span>
                      </span>
                      <div className="proj-overview-bar" aria-hidden="true">
                        <div className="proj-overview-bar-fill" style={{ width: `${project.progressPct}%`, background: project.color }} />
                      </div>
                    </button>
                  );
                })}

                {unassignedWork.length > 0 && (
                  <button type="button" className="proj-overview-row" onClick={() => setSelected('none')}>
                    <span className="proj-card-dot" style={{ background: '#ccc' }} />
                    <span className="proj-overview-main">
                      <span className="proj-overview-line">
                        <span className="proj-overview-name">Sin proyecto</span>
                        <span className="proj-status-pill is-inactive">Pendiente</span>
                      </span>
                      <span className="proj-overview-line proj-overview-line--subtle">
                        <span className="proj-overview-hours">{unassignedWork.reduce((s, w) => s + (w.hours || 0), 0).toFixed(1)}h</span>
                        <span className="proj-overview-activity">Última actividad: {formatShortDate(unassignedWork.reduce((latest, work) => (work.date > latest ? work.date : latest), ''))}</span>
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="proj-detail">
              <div className="proj-detail-hero" style={{ '--project-color': selectedProject?.color }}>
                <div className="proj-detail-head">
                  <span className="proj-detail-dot" style={{ background: selectedProject?.color }} />
                  <div className="proj-detail-info">
                    <h3 className="proj-detail-name">{selectedProject?.name}</h3>
                    <div className="proj-detail-summary">
                      <span className="proj-detail-total">{selectedTotal.toFixed(2)}h</span>
                      {selected !== 'none' && (
                        <span className="proj-detail-expected">
                          / {editingExpected === selected ? (
                            <input
                              type="number" step="1" className="inline-input proj-exp-input"
                              value={expectedVal}
                              onChange={e => setExpectedVal(e.target.value)}
                              onBlur={async () => {
                                await onUpdateExpected(selected, parseFloat(expectedVal) || 0);
                                setEditingExpected(null);
                              }}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                              autoFocus
                            />
                          ) : (
                            <button className="proj-exp-btn" onClick={() => {
                              setEditingExpected(selected);
                              setExpectedVal(String(selectedExpected || 0));
                            }}>
                              {selectedExpected || 0}h esperadas ({MONTH_NAMES[month]})
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="proj-detail-subtitle">
                      <span className={`proj-status-pill is-${selected === 'none' ? 'inactive' : (projectById.get(selected)?.statusKey || 'ok')}`}>{selectedLoadState}</span>
                      <span>{selectedExpected > 0 ? `${selectedProgress.toFixed(0)}% completado` : 'Sin objetivo definido'}</span>
                      <span>Última actividad: {formatShortDate(selectedLastActivity)}</span>
                    </div>
                  </div>
                  {selected !== 'none' && (
                    <button className="btn-delete proj-del-btn" onClick={() => del(selected, selectedProject?.name)} title="Eliminar proyecto">✕</button>
                  )}
                </div>

                {selectedExpected > 0 && (
                  <div className="proj-progress-bar">
                    <div
                      className={`proj-progress-fill ${selectedBalance > 0 ? 'is-over' : selectedProgress >= 85 ? 'is-warn' : 'is-ok'}`}
                      style={{ width: `${selectedProgress}%`, background: selectedProject?.color }}
                    />
                  </div>
                )}
              </div>

              {selected !== 'none' && (
                <div className="proj-detail-grid">
                  <section className="proj-detail-card">
                    <div className="proj-card-head">
                      <div>
                        <h4 className="proj-card-title">Descripción</h4>
                        <p className="proj-card-subtitle">Contexto corto para que el proyecto sea más legible.</p>
                      </div>
                    </div>
                    <textarea
                      className="proj-notes-textarea"
                      placeholder="Añadir descripción del proyecto..."
                      value={descVal}
                      onChange={e => setDescVal(e.target.value)}
                      onBlur={() => saveField('description', descVal)}
                      rows={4}
                    />
                  </section>

                  <section className="proj-detail-card">
                    <div className="proj-card-head">
                      <div>
                        <h4 className="proj-card-title">Links de interés</h4>
                        <p className="proj-card-subtitle">Referencias, documentación o acceso rápido.</p>
                      </div>
                    </div>
                    <div className="proj-links-list">
                      {linksVal.split('\n').filter(l => l.trim()).map((link, i) => {
                        const url = link.trim();
                        const isUrl = url.startsWith('http://') || url.startsWith('https://');
                        let hostname = '';
                        try { hostname = new URL(url).hostname; } catch { hostname = url; }
                        return (
                          <div key={i} className="proj-link-card">
                            {isUrl && (
                              <img
                                src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
                                alt=""
                                className="proj-link-favicon"
                                loading="lazy"
                                decoding="async"
                                fetchPriority="low"
                                width="20"
                                height="20"
                                referrerPolicy="no-referrer"
                              />
                            )}
                            {isUrl ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="proj-link-url">
                                <span className="proj-link-host">{hostname}</span>
                                <span className="proj-link-full">{url}</span>
                              </a>
                            ) : (
                              <span className="proj-link-url"><span className="proj-link-host">{url}</span></span>
                            )}
                            <button className="btn-delete" onClick={async () => {
                              const updated = linksVal.split('\n').filter((_, j) => j !== i).join('\n');
                              setLinksVal(updated);
                              await saveField('links', updated);
                            }} title="Eliminar">✕</button>
                          </div>
                        );
                      })}
                    </div>
                    <form className="proj-link-add" onSubmit={async (e) => {
                      e.preventDefault();
                      if (!newLink.trim()) return;
                      const updated = linksVal ? linksVal + '\n' + newLink.trim() : newLink.trim();
                      setLinksVal(updated);
                      setNewLink('');
                      await saveField('links', updated);
                    }}>
                      <input
                        type="text" className="inline-input" placeholder="Pegar URL y pulsar Enter..."
                        value={newLink} onChange={e => setNewLink(e.target.value)}
                      />
                      <button type="submit" className="btn-add" disabled={!newLink.trim()}>+</button>
                    </form>
                  </section>
                </div>
              )}

              <section className="proj-detail-card proj-detail-card--activity">
                <div className="proj-card-head proj-card-head--split">
                  <div>
                    <h4 className="proj-card-title">Actividad</h4>
                    <p className="proj-card-subtitle">Horas, notas y reuniones del mes.</p>
                  </div>
                  <div className="proj-card-actions">
                    <button type="button" className="proj-toggle-btn" onClick={() => setShowEntries(prev => !prev)}>
                      {showEntries ? 'Ocultar entradas' : 'Ver entradas'}
                    </button>
                    <button type="button" className="proj-toggle-btn" onClick={() => setShowMeetings(prev => !prev)}>
                      {showMeetings ? 'Ocultar reuniones' : 'Ver reuniones'}
                    </button>
                  </div>
                </div>

                {selectedEntries.length === 0 && selectedMeetings.length === 0 ? (
                  <div className="proj-empty proj-empty-card">
                    <strong>Este proyecto está limpio este mes.</strong>
                    <span>Registra horas o añade una reunión para empezar a ver actividad aquí.</span>
                  </div>
                ) : (
                  <div className="proj-detail-body proj-detail-body--cards">
                    {showEntries && selectedEntries.length > 0 && (
                      <div className="proj-subsection-card">
                        <div className="proj-subsection-head">
                          <h5 className="proj-subsection-title">Entradas</h5>
                          <span className="proj-subsection-meta">{selectedEntries.length}</span>
                        </div>
                        <ul className="proj-entry-list">
                          {selectedEntries.map(w => {
                            const d = new Date(w.date + 'T00:00:00');
                            const dayStr = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                            const isEditing = editingWorkId === w.id;
                            return (
                              <li key={w.id} className={`proj-entry-item ${openWorkNoteId === w.id ? 'note-open' : ''}`}>
                                {isEditing ? (
                                  <>
                                    <div className="proj-entry-top proj-entry-top-edit">
                                      <span className="proj-entry-date">{dayStr}</span>
                                      <input
                                        type="number"
                                        step="0.25"
                                        min="0"
                                        max="24"
                                        className="inline-input proj-entry-hours-input"
                                        value={editWorkHours}
                                        onChange={e => setEditWorkHours(e.target.value)}
                                      />
                                      <FlowbiteDropdown
                                        className="inline-select proj-entry-project-select"
                                        value={editWorkProjectId}
                                        onChange={setEditWorkProjectId}
                                        options={[
                                          { value: '', label: 'Sin proyecto' },
                                          ...projects.map(p => ({ value: String(p.id), label: p.name })),
                                        ]}
                                        ariaLabel="Proyecto"
                                      />
                                    </div>
                                    <textarea
                                      className="inline-textarea proj-entry-note-edit"
                                      rows={2}
                                      placeholder="Notas (opcional)"
                                      value={editWorkNote}
                                      onChange={e => setEditWorkNote(e.target.value)}
                                    />
                                    <div className="proj-entry-edit-actions">
                                      <button className="btn btn-primary btn-sm" onClick={() => saveEditWork(w.id)}>Guardar</button>
                                      <button className="btn btn-ghost btn-sm" onClick={cancelEditWork}>Cancelar</button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="proj-entry-top">
                                      <span className="proj-entry-date">{dayStr}</span>
                                      <span className="proj-entry-hours">{(w.hours || 0).toFixed(2)}h</span>
                                      <button className="btn-edit" onClick={() => startEditWork(w)} title="Editar">✎</button>
                                      {w.note && (
                                        <button
                                          type="button"
                                          className={`note-tri ${openWorkNoteId === w.id ? 'open' : ''}`}
                                          onClick={() => toggleWorkNote(w.id)}
                                          aria-expanded={openWorkNoteId === w.id}
                                          title="Ver nota"
                                        >▶</button>
                                      )}
                                      <button className="btn-delete" onClick={async () => {
                                        await api.deleteWork(w.id);
                                        loadMonthWork();
                                        reload();
                                      }} title="Eliminar">✕</button>
                                    </div>
                                    {w.note && <p className="proj-entry-note">{w.note}</p>}
                                  </>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {showMeetings && selectedMeetings.length > 0 && (
                      <div className="proj-subsection-card">
                        <div className="proj-subsection-head">
                          <h5 className="proj-subsection-title">Reuniones</h5>
                          <span className="proj-subsection-meta">{calcMeetingHours(selectedMeetings).toFixed(1)}h</span>
                        </div>
                        <ul className="proj-entry-list">
                          {selectedMeetings.map(m => {
                            const d = new Date(m.date + 'T00:00:00');
                            const dayStr = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                            const mMins = !m.allDay && m.startTime && m.endTime
                              ? (() => { const [sh, sm] = m.startTime.split(':').map(Number); const [eh, em] = m.endTime.split(':').map(Number); return (eh * 60 + em) - (sh * 60 + sm); })()
                              : 0;
                            return (
                              <li key={m.uid + m.date} className="proj-entry-item proj-meeting-item">
                                <div className="proj-entry-top">
                                  <span className="proj-entry-icon">📞</span>
                                  <span className="proj-entry-date">{dayStr}</span>
                                  {mMins > 0 && <span className="proj-entry-hours">{mMins >= 60 ? `${Math.floor(mMins / 60)}h${mMins % 60 ? ` ${mMins % 60}m` : ''}` : `${mMins}m`}</span>}
                                </div>
                                <div className="proj-meeting-title">{m.title}</div>
                                {m.startTime && <div className="proj-meeting-time">{m.startTime}{m.endTime ? ` – ${m.endTime}` : ''}</div>}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
