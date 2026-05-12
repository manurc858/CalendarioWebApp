import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { MONTH_NAMES, iso, fmtHours, calcMeetingHours } from '../utils.js';

const COLORS = ['#a78bfa', '#86efac', '#fbbf24', '#f87171', '#60a5fa', '#34d399', '#f472b6', '#38bdf8'];

export default function ProjectsPage({ projects, stats, cursor, reload, onUpdateExpected }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null); // project id or 'none'
  const [editingExpected, setEditingExpected] = useState(null);
  const [expectedVal, setExpectedVal] = useState('');
  const [descVal, setDescVal] = useState('');
  const [linksVal, setLinksVal] = useState('');
  const [newLink, setNewLink] = useState('');

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

  const projectsWithWork = projects.filter(p =>
    monthWork.some(w => w.project_id === p.id) ||
    monthMeetings.some(m => m.project_id === p.id)
  );
  const projectsWithoutWork = projects.filter(p =>
    !monthWork.some(w => w.project_id === p.id) &&
    !monthMeetings.some(m => m.project_id === p.id)
  );
  const unassignedWork = monthWork.filter(w => !w.project_id);

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

  const selectedStat = selected !== 'none' ? stats.find(s => s.id === selected) : null;
  const selectedExpected = selectedStat?.expected_hours_month || 0;
  const selectedTotal = selectedEntries.reduce((s, w) => s + (w.hours || 0), 0) + calcMeetingHours(selectedMeetings);

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

  return (
    <div className="proj-layout">
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
        <div className="proj-list">
          {projectsWithWork.length === 0 && unassignedWork.length === 0 && (
            <div className="proj-empty">Sin entradas de trabajo este mes</div>
          )}

          {projectsWithWork.map(p => {
            const totalH = totalForProject(p.id);
            const stat = stats.find(s => s.id === p.id);
            const expectedH = stat?.expected_hours_month || 0;
            const isActive = selected === p.id;

            return (
              <button
                key={p.id}
                className={`proj-list-item ${isActive ? 'active' : ''}`}
                onClick={() => setSelected(isActive ? null : p.id)}
              >
                <span className="proj-card-dot" style={{ background: p.color }} />
                <span className="proj-list-name">{p.name}</span>
                <span className="proj-list-hours">{totalH.toFixed(1)}h</span>
                {expectedH > 0 && <span className="proj-list-expected">/ {expectedH}h</span>}
              </button>
            );
          })}

          {unassignedWork.length > 0 && (
            <button
              className={`proj-list-item ${selected === 'none' ? 'active' : ''}`}
              onClick={() => setSelected(selected === 'none' ? null : 'none')}
            >
              <span className="proj-card-dot" style={{ background: '#ccc' }} />
              <span className="proj-list-name">Sin proyecto</span>
              <span className="proj-list-hours">
                {unassignedWork.reduce((s, w) => s + (w.hours || 0), 0).toFixed(1)}h
              </span>
            </button>
          )}
        </div>

        {/* Projects without work */}
        {projectsWithoutWork.length > 0 && (
          <div className="proj-other-section">
            <h4 className="proj-section-sub">Sin entradas este mes</h4>
            <div className="proj-chips">
              {projectsWithoutWork.map(p => (
                <div key={p.id} className="proj-chip">
                  <span className="proj-card-dot" style={{ background: p.color }} />
                  <span>{p.name}</span>
                  <button className="btn-delete" onClick={() => del(p.id, p.name)} title="Eliminar">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* RIGHT: detail panel for selected project */}
      <div className="proj-right">
        {selected == null ? (
          <div className="proj-overview">
            <h3 className="proj-overview-title">📊 Resumen — {MONTH_NAMES[month]} {year}</h3>
            <div className="proj-overview-total">
              Total: <strong>{(monthWork.reduce((s, w) => s + (w.hours || 0), 0) + calcMeetingHours(monthMeetings.filter(m => m.project_id))).toFixed(1)}h</strong>
            </div>
            <div className="proj-overview-list">
              {projects.map(p => {
                const worked = totalForProject(p.id);
                const stat = stats.find(s => s.id === p.id);
                const expected = stat?.expected_hours_month || 0;
                const pct = expected > 0 ? Math.min(100, (worked / expected) * 100) : 0;
                return (
                  <div key={p.id} className="proj-overview-row" onClick={() => setSelected(p.id)}>
                    <span className="proj-card-dot" style={{ background: p.color }} />
                    <span className="proj-overview-name">{p.name}</span>
                    <span className="proj-overview-hours">{worked.toFixed(1)}h</span>
                    {expected > 0 && <span className="proj-overview-exp">/ {expected}h</span>}
                    {expected > 0 && (
                      <div className="proj-overview-bar">
                        <div className="proj-overview-bar-fill" style={{ width: `${pct}%`, background: p.color }} />
                      </div>
                    )}
                  </div>
                );
              })}
              {unassignedWork.length > 0 && (
                <div className="proj-overview-row" onClick={() => setSelected('none')}>
                  <span className="proj-card-dot" style={{ background: '#ccc' }} />
                  <span className="proj-overview-name">Sin proyecto</span>
                  <span className="proj-overview-hours">{unassignedWork.reduce((s, w) => s + (w.hours || 0), 0).toFixed(1)}h</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="proj-detail">
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
              </div>
              {selected !== 'none' && (
                <button className="btn-delete proj-del-btn" onClick={() => del(selected, selectedProject?.name)} title="Eliminar proyecto">✕</button>
              )}
            </div>

            {selectedExpected > 0 && (
              <div className="proj-progress-bar">
                <div className="proj-progress-fill" style={{
                  width: `${Math.min(100, (selectedTotal / selectedExpected) * 100)}%`,
                  background: selectedProject?.color
                }} />
              </div>
            )}

            {/* Project notes */}
            {selected !== 'none' && (
              <div className="proj-notes">
                <div className="proj-notes-field">
                  <label className="proj-notes-label">Descripción</label>
                  <textarea
                    className="proj-notes-textarea"
                    placeholder="Añadir descripción del proyecto..."
                    value={descVal}
                    onChange={e => setDescVal(e.target.value)}
                    onBlur={() => saveField('description', descVal)}
                    rows={3}
                  />
                </div>
                <div className="proj-notes-field">
                  <label className="proj-notes-label">Links de interés</label>
                  <div className="proj-links-list">
                    {linksVal.split('\n').filter(l => l.trim()).map((link, i) => {
                      const url = link.trim();
                      const isUrl = url.startsWith('http://') || url.startsWith('https://');
                      let hostname = '';
                      try { hostname = new URL(url).hostname; } catch { hostname = url; }
                      return (
                        <div key={i} className="proj-link-card">
                          {isUrl && <img src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`} alt="" className="proj-link-favicon" />}
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
                </div>
              </div>
            )}

            <div className="proj-detail-body">
              {selectedEntries.length === 0 && selectedMeetings.length === 0 ? (
                <div className="proj-empty">Sin entradas</div>
              ) : (
                <>
                  {selectedEntries.length > 0 && (
                    <ul className="proj-entry-list">
                      {selectedEntries.map(w => {
                        const d = new Date(w.date + 'T00:00:00');
                        const dayStr = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                        return (
                          <li key={w.id} className="proj-entry-item">
                            <div className="proj-entry-top">
                              <span className="proj-entry-date">{dayStr}</span>
                              <span className="proj-entry-hours">{(w.hours || 0).toFixed(2)}h</span>
                              {w.note && <button className="note-tri" onClick={e => e.currentTarget.closest('.proj-entry-item').classList.toggle('note-open')} title="Ver nota">▶</button>}
                              <button className="btn-delete" onClick={async () => {
                                await api.deleteWork(w.id);
                                loadMonthWork();
                                reload();
                              }} title="Eliminar">✕</button>
                            </div>
                            {w.note && <p className="proj-entry-note">{w.note}</p>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {selectedMeetings.length > 0 && (
                    <>
                      <h4 className="proj-section-sub" style={{ marginTop: '0.75rem' }}>📞 Reuniones ({calcMeetingHours(selectedMeetings).toFixed(1)}h)</h4>
                      <ul className="proj-entry-list">
                        {selectedMeetings.map(m => {
                          const d = new Date(m.date + 'T00:00:00');
                          const dayStr = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                          const mMins = !m.allDay && m.startTime && m.endTime
                            ? (() => { const [sh,sm] = m.startTime.split(':').map(Number); const [eh,em] = m.endTime.split(':').map(Number); return (eh*60+em)-(sh*60+sm); })()
                            : 0;
                          return (
                            <li key={m.uid + m.date} className="proj-entry-item proj-meeting-item">
                              <div className="proj-entry-top">
                                <span className="proj-entry-icon">📞</span>
                                <span className="proj-entry-date">{dayStr}</span>
                                {mMins > 0 && <span className="proj-entry-hours">{mMins >= 60 ? `${Math.floor(mMins/60)}h${mMins%60 ? ` ${mMins%60}m` : ''}` : `${mMins}m`}</span>}
                              </div>
                              <div className="proj-meeting-title">{m.title}</div>
                              {m.startTime && <div className="proj-meeting-time">{m.startTime}{m.endTime ? ` – ${m.endTime}` : ''}</div>}
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
