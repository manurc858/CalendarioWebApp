import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { diffMinutes, fmtHours, LABOR_TYPES, effectiveLabor } from '../utils.js';

const DEFAULT_SLOTS = [
  { start_time: '07:45', end_time: '13:30' },
  { start_time: '14:30', end_time: '17:30' },
];

export default function DayEditModal({ date, onClose, projects, laborMap }) {
  const [data, setData] = useState({ work: [], todos: [], events: [] });
  const [loading, setLoading] = useState(true);
  const effectiveType = effectiveLabor(new Date(date + 'T00:00:00'), laborMap);

  const reload = async () => {
    setLoading(true);
    setData(await api.getDay(date));
    setLoading(false);
  };
  useEffect(() => { reload(); }, [date]);

  const totalMin = data.work.reduce((a, w) => a + diffMinutes(w.start_time, w.end_time), 0);

  // Forms
  const [workForms, setWorkForms] = useState(DEFAULT_SLOTS.map(s => ({ ...s, project_id: '', note: '' })));
  const [todoText, setTodoText] = useState('');
  const [eventForm, setEventForm] = useState({ title: '', kind: 'event' });

  const updateWorkForm = (i, field, value) => {
    const updated = [...workForms];
    updated[i][field] = value;
    setWorkForms(updated);
  };

  const addWorkForm = () => {
    setWorkForms([...workForms, { start_time: '09:00', end_time: '13:00', project_id: '', note: '' }]);
  };

  const removeWorkForm = (i) => {
    setWorkForms(workForms.filter((_, idx) => idx !== i));
  };

  const addWork = async (i) => {
    const form = workForms[i];
    if (!form.start_time || !form.end_time) return;
    await api.createWork({
      date,
      start_time: form.start_time,
      end_time: form.end_time,
      project_id: form.project_id ? Number(form.project_id) : null,
      note: form.note || null,
    });
    removeWorkForm(i);
    reload();
  };

  const addTodo = async (e) => {
    e.preventDefault();
    if (!todoText.trim()) return;
    await api.createTodo({ date, text: todoText.trim() });
    setTodoText('');
    reload();
  };

  const addEvent = async (e) => {
    e.preventDefault();
    if (!eventForm.title.trim()) return;
    await api.createEvent({ date, title: eventForm.title.trim(), kind: eventForm.kind });
    setEventForm({ title: '', kind: 'event' });
    reload();
  };

  const parsed = new Date(date + 'T00:00:00');
  const pretty = parsed.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  if (loading) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <div className="modal-date">{pretty.charAt(0).toUpperCase() + pretty.slice(1)}</div>
            {effectiveType.label && (
              <div className="modal-labor"
                   style={{ background: LABOR_TYPES[effectiveType.type].color, color: LABOR_TYPES[effectiveType.type].text }}>
                {LABOR_TYPES[effectiveType.type].label}
              </div>
            )}
          </div>
          <div className="modal-total">
            <span className="muted">Total</span>
            <strong>{fmtHours(totalMin)}</strong>
          </div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <div className="modal-body">
          {/* WORK */}
          <section className="panel">
            <h3>⏱ Horas de trabajo</h3>
            <ul className="list">
              {data.work.map(w => (
                <li key={w.id} className="list-item">
                  <span className="swatch" style={{ background: w.project_color || '#4f8cff' }} />
                  <div className="li-main">
                    <div><b>{w.start_time} – {w.end_time}</b> <span className="muted">({fmtHours(diffMinutes(w.start_time, w.end_time))})</span></div>
                    <div className="muted small">{w.project_name || 'Sin proyecto'}</div>
                    {w.note && <div className="day-entry-note" style={{display:'none'}}>{w.note}</div>}
                  </div>
                  {w.note && <button className="note-tri" onClick={e => { const note = e.currentTarget.closest('.list-item').querySelector('.day-entry-note'); note.style.display = note.style.display === 'none' ? '' : 'none'; e.currentTarget.classList.toggle('open'); }} title="Ver nota">▶</button>}
                  <button className="btn btn-link danger" onClick={async () => { await api.deleteWork(w.id); reload(); }}>Eliminar</button>
                </li>
              ))}
            </ul>

            <div className="work-forms">
              {workForms.map((form, i) => (
                <div key={i} className="work-form">
                  <input type="time" value={form.start_time}
                         onChange={e => updateWorkForm(i, 'start_time', e.target.value)} />
                  <span className="sep">→</span>
                  <input type="time" value={form.end_time}
                         onChange={e => updateWorkForm(i, 'end_time', e.target.value)} />
                  <select value={form.project_id}
                          onChange={e => updateWorkForm(i, 'project_id', e.target.value)}>
                    <option value="">— Proyecto —</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input type="text" placeholder="Nota"
                         value={form.note}
                         onChange={e => updateWorkForm(i, 'note', e.target.value)} />
                  <button className="btn btn-primary" onClick={() => addWork(i)}>Añadir</button>
                  <button className="btn btn-ghost" onClick={() => removeWorkForm(i)}>Borrar</button>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost" onClick={addWorkForm}>+ Otra entrada</button>
          </section>

          {/* TODOS */}
          <section className="panel">
            <h3>✅ To-do del día</h3>
            <ul className="list">
              {data.todos.map(t => (
                <li key={t.id} className="list-item">
                  <input type="checkbox" checked={!!t.done}
                         onChange={async e => { await api.updateTodo(t.id, { done: e.target.checked ? 1 : 0 }); reload(); }} />
                  <div className="li-main">
                    <span className={t.done ? 'done' : ''}>{t.text}</span>
                  </div>
                  <button className="btn btn-link danger" onClick={async () => { await api.deleteTodo(t.id); reload(); }}>Eliminar</button>
                </li>
              ))}
            </ul>
            <form className="form-row" onSubmit={addTodo}>
              <input type="text" placeholder="Nueva tarea…" value={todoText} onChange={e => setTodoText(e.target.value)} />
              <button className="btn btn-primary" type="submit">Añadir</button>
            </form>
          </section>

          {/* EVENTS */}
          <section className="panel">
            <h3>📌 Eventos y entregas</h3>
            <ul className="list">
              {data.events.map(ev => (
                <li key={ev.id} className="list-item">
                  <span className={`badge ${ev.kind}`}>{ev.kind === 'delivery' ? 'Entrega' : 'Evento'}</span>
                  <div className="li-main">{ev.title}</div>
                  <button className="btn btn-link danger" onClick={async () => { await api.deleteEvent(ev.id); reload(); }}>Eliminar</button>
                </li>
              ))}
            </ul>
            <form className="form-row" onSubmit={addEvent}>
              <select value={eventForm.kind}
                      onChange={e => setEventForm({ ...eventForm, kind: e.target.value })}>
                <option value="event">Evento</option>
                <option value="delivery">Entrega</option>
              </select>
              <input type="text" placeholder="Título…" value={eventForm.title}
                     onChange={e => setEventForm({ ...eventForm, title: e.target.value })} />
              <button className="btn btn-primary" type="submit">Añadir</button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
