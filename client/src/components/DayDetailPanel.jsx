import { useEffect, useState, useRef } from 'react';
import { api } from '../api.js';
import { fmtHours, LABOR_TYPES, effectiveLabor, calcMeetingHours } from '../utils.js';
import MeetingNotesEditor from './MeetingNotesEditor.jsx';
import CreateMeetingModal from './CreateMeetingModal.jsx';

export default function DayDetailPanel({ date, laborMap, projects, onReload }) {
  const [data, setData] = useState({ work: [], todos: [], events: [], meetings: [] });
  const [loading, setLoading] = useState(true);

  // Inline form states
  const [newHours, setNewHours] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [newNote, setNewNote] = useState('');
  const [todoText, setTodoText] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventKind, setEventKind] = useState('event');

  // Meeting notes / create modal state
  const [notesEditor, setNotesEditor] = useState(null); // { meetingType, meetingRef, meetingDate }
  const [showCreateMeeting, setShowCreateMeeting] = useState(false);

  const noteTextareaRef = useRef(null);

  // Auto-resize textarea when text is changed programmatically
  useEffect(() => {
    if (noteTextareaRef.current) {
      noteTextareaRef.current.style.height = 'auto';
      noteTextareaRef.current.style.height = noteTextareaRef.current.scrollHeight + 'px';
    }
  }, [newNote]);

  const reload = async () => {
    setLoading(true);
    setData(await api.getDay(date));
    setLoading(false);
  };
  useEffect(() => { reload(); }, [date]);

  const parsed = new Date(date + 'T00:00:00');
  const effectiveType = effectiveLabor(parsed, laborMap);
  const workHours = data.work.reduce((a, w) => a + (w.hours || 0), 0);
  const meetHours = calcMeetingHours(data.meetings);
  const totalHours = workHours + meetHours;

  // Target hours: 8.75 Mon-Thu, 6 Fri, 0 weekend
  const dow = parsed.getDay(); // 0=Sun
  const targetHours = (dow >= 1 && dow <= 4) ? 8.75 : dow === 5 ? 6 : 0;
  const pct = targetHours > 0 ? Math.min(100, (totalHours / targetHours) * 100) : 0;

  const pretty = parsed.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long'
  });

  const addWork = async (e) => {
    e.preventDefault();
    const h = parseFloat(newHours);
    if (!h || h <= 0) return;
    await api.createWork({
      date,
      hours: h,
      project_id: newProjectId ? Number(newProjectId) : null,
      note: newNote || null,
    });
    setNewHours(''); setNewNote('');
    reload();
    onReload?.();
  };

  const deleteWork = async (id) => {
    await api.deleteWork(id);
    reload();
    onReload?.();
  };

  const addTodo = async (e) => {
    e.preventDefault();
    if (!todoText.trim()) return;
    await api.createTodo({ date, text: todoText.trim() });
    setTodoText('');
    reload();
    onReload?.();
  };

  const deleteTodo = async (id) => {
    await api.deleteTodo(id);
    reload();
    onReload?.();
  };

  const addEvent = async (e) => {
    e.preventDefault();
    if (!eventTitle.trim()) return;
    await api.createEvent({ date, title: eventTitle.trim(), kind: eventKind });
    setEventTitle('');
    reload();
    onReload?.();
  };

  const deleteEvent = async (id) => {
    await api.deleteEvent(id);
    reload();
    onReload?.();
  };

  if (loading) {
    return (
      <div className="day-detail">
        <div className="day-detail-empty">Cargando…</div>
      </div>
    );
  }

  return (
    <div className="day-detail">
      <header className="day-detail-head">
        <div>
          <div className="day-detail-date">{pretty.charAt(0).toUpperCase() + pretty.slice(1)}</div>
          {effectiveType.label && (
            <span className="day-detail-labor"
              style={{ background: LABOR_TYPES[effectiveType.type].color, color: LABOR_TYPES[effectiveType.type].text }}>
              {LABOR_TYPES[effectiveType.type].label}
            </span>
          )}
        </div>
        <span className="day-detail-total">{totalHours > 0 ? `${totalHours.toFixed(2)}h` : '0h'}</span>
      </header>

      {/* Hours progress bar */}
      {targetHours > 0 && (
        <div className="day-progress">
          <div className="day-progress-bar">
            <div
              className={`day-progress-fill ${pct >= 100 ? 'complete' : pct >= 50 ? 'half' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="day-progress-label">{totalHours.toFixed(2)} / {targetHours}h</span>
        </div>
      )}

      <div className="day-detail-body">
        {/* ---- Work hours ---- */}
        <section className="day-section">
          <h4 className="day-section-title">⏱ Horas de trabajo</h4>
          {data.work.length > 0 && (
            <ul className="day-entries">
              {data.work.map(w => (
                <li
                  key={w.id}
                  className="day-entry"
                  onDragOver={e => {
                    e.preventDefault();
                    e.currentTarget.classList.add('drag-over');
                  }}
                  onDragLeave={e => {
                    e.currentTarget.classList.remove('drag-over');
                  }}
                  onDrop={async e => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('drag-over');
                    const droppedText = e.dataTransfer.getData('text/plain');
                    if (droppedText) {
                      const noteLine = `[TAREA] ${droppedText}`;
                      const newNoteText = w.note ? `${w.note}\n${noteLine}` : noteLine;
                      await api.updateWork(w.id, {
                        hours: w.hours,
                        project_id: w.project_id,
                        note: newNoteText
                      });
                      reload();
                      onReload?.();
                    }
                  }}
                >
                  <span className="day-entry-swatch" style={{ background: w.project_color || '#4f8cff' }} />
                  <div className="day-entry-info">
                    <div className="day-entry-time">{(w.hours || 0).toFixed(2)}h</div>
                    <div className="day-entry-project">{w.project_name || 'Sin proyecto'}</div>
                  </div>
                  <div className="day-entry-actions">
                    {w.note && <button className="note-tri" onClick={e => e.currentTarget.closest('.day-entry').classList.toggle('note-open')} title="Ver nota">▶</button>}
                    <button className="btn-delete" onClick={() => deleteWork(w.id)} title="Eliminar">✕</button>
                  </div>
                  {w.note && (
                    <div className="day-entry-note">
                      {w.note.split('\n').map((line, i) => {
                        const isTask = line.startsWith('[TAREA] ');
                        if (isTask) {
                          const taskText = line.substring(8);
                          return (
                            <div key={i} className="note-task-block">
                              <span className="note-task-icon" title="Tarea vinculada">📌</span>
                              <span className="note-task-text">{taskText}</span>
                              <button
                                className="btn-delete btn-sm btn-detach"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const lines = w.note.split('\n');
                                  lines.splice(i, 1);
                                  await api.updateWork(w.id, {
                                    hours: w.hours,
                                    project_id: w.project_id,
                                    note: lines.join('\n').trim()
                                  });
                                  reload();
                                  onReload?.();
                                }}
                                title="Desvincular tarea"
                              >✕</button>
                            </div>
                          );
                        }
                        return (
                          <div key={i} className="note-task-block">
                            <span className="note-task-icon" title="Nota">📝</span>
                            <span className="note-task-text">{line}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form className="work-add-form" onSubmit={addWork}>
            <div className="work-add-row">
              <input
                type="number" step="0.25" min="0" max="24"
                placeholder="Horas"
                value={newHours}
                onChange={e => setNewHours(e.target.value)}
                className="inline-input hours-input"
              />
              <select value={newProjectId} onChange={e => setNewProjectId(e.target.value)} className="inline-select">
                <option value="">Sin proyecto</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="submit" className="btn-add" disabled={!newHours}>+</button>
            </div>
            <textarea
              ref={noteTextareaRef}
              placeholder="Notas (opcional) - arrastra aquí tareas"
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              onDragOver={e => {
                e.preventDefault();
                e.currentTarget.classList.add('drag-over');
              }}
              onDragLeave={e => {
                e.currentTarget.classList.remove('drag-over');
              }}
              onDrop={e => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                const droppedText = e.dataTransfer.getData('text/plain');
                if (droppedText) {
                  const noteLine = `[TAREA] ${droppedText}`;
                  setNewNote(prev => prev ? `${prev}\n${noteLine}` : noteLine);
                }
              }}
              className="inline-textarea"
              rows={1}
              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
            />
          </form>
        </section>

        {/* ---- Todos ---- */}
        <section className="day-section">
          <h4 className="day-section-title">✅ Tareas</h4>
          {data.todos.length > 0 && (
            <ul className="day-entries">
              {data.todos.map(t => (
                <li
                  key={t.id}
                  className="day-entry todo-entry"
                  draggable
                  onDragStart={e => e.dataTransfer.setData('text/plain', t.text)}
                  title="Arrastra esta tarea a las notas de trabajo"
                >
                  <input type="checkbox" checked={!!t.done}
                    onChange={async e => {
                      await api.updateTodo(t.id, { done: e.target.checked ? 1 : 0 });
                      reload();
                      onReload?.();
                    }}
                    className="day-todo-check" />
                  <span className={`todo-text ${t.done ? 'done' : ''}`}>{t.text}</span>
                  <button className="btn-delete" onClick={() => deleteTodo(t.id)} title="Eliminar">✕</button>
                </li>
              ))}
            </ul>
          )}
          <form className="inline-form" onSubmit={addTodo}>
            <input
              type="text" placeholder="Nueva tarea…"
              value={todoText}
              onChange={e => setTodoText(e.target.value)}
              className="inline-input flex-1"
            />
            <button type="submit" className="btn-add" disabled={!todoText.trim()}>+</button>
          </form>
        </section>

        {/* ---- Events ---- */}
        <section className="day-section">
          <h4 className="day-section-title">📌 Eventos</h4>
          {data.events.length > 0 && (
            <ul className="day-entries">
              {data.events.map(ev => (
                <li key={ev.id} className="day-entry event-entry">
                  <span className="day-event-badge">
                    {ev.kind === 'delivery' ? '📦' : '🎯'}
                  </span>
                  <div className="day-entry-info">
                    <div className="day-entry-event-title">{ev.title}</div>
                    <div className="day-entry-event-kind">{ev.kind === 'delivery' ? 'Entrega' : 'Evento'}</div>
                  </div>
                  <button className="btn-delete" onClick={() => deleteEvent(ev.id)} title="Eliminar">✕</button>
                </li>
              ))}
            </ul>
          )}
          <form className="inline-form" onSubmit={addEvent}>
            <select value={eventKind} onChange={e => setEventKind(e.target.value)} className="inline-select">
              <option value="event">Evento</option>
              <option value="delivery">Entrega</option>
            </select>
            <input
              type="text" placeholder="Título…"
              value={eventTitle}
              onChange={e => setEventTitle(e.target.value)}
              className="inline-input flex-1"
            />
            <button type="submit" className="btn-add" disabled={!eventTitle.trim()}>+</button>
          </form>
        </section>

        {/* ---- Meetings ---- */}
        <section className="day-section">
          <div className="day-section-header">
            <h4 className="day-section-title">📞 Reuniones</h4>
            <button className="btn-add btn-add-meeting" onClick={() => setShowCreateMeeting(true)} title="Nueva reunión">+</button>
          </div>
          {data.meetings && data.meetings.length > 0 && (
            <ul className="day-entries">
              {data.meetings.map(m => {
                const mMins = (!m.allDay && m.startTime && m.endTime)
                  ? (() => { const [sh,sm] = m.startTime.split(':').map(Number); const [eh,em] = m.endTime.split(':').map(Number); return (eh*60+em)-(sh*60+sm); })()
                  : 0;
                const meetingType = m.isCustom ? 'custom' : 'outlook';
                const meetingRef = m.isCustom ? String(m.customId) : m.uid;
                return (
                  <li key={m.uid} className={`day-entry meeting-entry${m.project_id ? ' meeting-assigned' : ''}${m.isCustom ? ' meeting-custom' : ''}`}>
                    <span className="day-entry-swatch" style={{ background: m.project_color || (m.isCustom ? '#a78bfa' : 'var(--line)') }} />
                    <div className="day-entry-info">
                      <div className="meeting-header">
                        <div className="meeting-title">
                          {m.isCustom && <span className="meeting-custom-badge">✦</span>}
                          {m.title}
                        </div>
                        {mMins > 0 && <span className="meeting-dur">{mMins >= 60 ? `${Math.floor(mMins/60)}h${mMins%60 ? ` ${mMins%60}m` : ''}` : `${mMins}m`}</span>}
                      </div>
                      <div className="meeting-time">
                        {m.allDay ? 'Todo el día' : `${m.startTime}${m.endTime ? ` – ${m.endTime}` : ''}`}
                      </div>
                      <div className="meeting-project-row">
                        <select
                          className={`meeting-project-select${m.project_id ? ' has-project' : ''}`}
                          style={m.project_id ? { background: m.project_color || '#ccc', color: 'white', borderColor: 'transparent' } : {}}
                          value={m.project_id || ''}
                          onChange={async (e) => {
                            await api.setMeetingProject(m.uid, date, e.target.value ? Number(e.target.value) : null);
                            reload();
                            onReload?.();
                          }}
                        >
                          <option value="">{m.project_id ? '✕ Quitar proyecto' : '+ Asignar proyecto…'}</option>
                          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <button
                          className="btn btn-ghost btn-sm meeting-notes-btn"
                          onClick={() => setNotesEditor({ meetingType, meetingRef, meetingDate: date })}
                        >
                          📝 Notas
                        </button>
                        {m.isCustom && (
                          <button
                            className="btn-delete"
                            onClick={async () => {
                              await api.deleteCustomMeeting(m.customId);
                              reload();
                              onReload?.();
                            }}
                            title="Eliminar reunión"
                          >✕</button>
                        )}
                      </div>
                      {!m.isCustom && m.teamsUrl && (
                        <a href={m.teamsUrl} target="_blank" rel="noopener noreferrer" className="meeting-link">
                          🎥 Unirse a Teams
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {(!data.meetings || data.meetings.length === 0) && (
            <div className="day-empty-hint">Sin reuniones</div>
          )}
        </section>
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
          initialDate={date}
          onClose={() => setShowCreateMeeting(false)}
          onCreated={() => { reload(); onReload?.(); }}
        />
      )}
    </div>
  );
}
