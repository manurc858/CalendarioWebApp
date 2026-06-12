import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { diffMinutes, fmtHours, LABOR_TYPES, effectiveLabor } from '../utils.js';
import FlowbiteDropdown from './FlowbiteDropdown.jsx';

const DEFAULT_SLOTS = [
  { start_time: '07:45', end_time: '13:30' },
  { start_time: '14:30', end_time: '17:30' },
];

export default function DayEditModal({ date, onClose, projects, laborMap }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const [data, setData] = useState({ work: [], todos: [], events: [] });
  const [openWorkNotes, setOpenWorkNotes] = useState({});
  const [loading, setLoading] = useState(true);
  const effectiveType = effectiveLabor(new Date(date + 'T00:00:00'), laborMap);

  const reload = async () => {
    setLoading(true);
    setData(await api.getDay(date));
    setOpenWorkNotes({});
    setLoading(false);
  };
  useEffect(() => { reload(); }, [date]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    restoreFocusRef.current = document.activeElement;
    if (!dialog.open) dialog.showModal();

    const onCancel = (e) => {
      e.preventDefault();
      onClose();
    };

    const onBackdropClick = (e) => {
      if (e.target === dialog) onClose();
    };

    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdropClick);

    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onBackdropClick);
      if (dialog.open) dialog.close();
      const toFocus = restoreFocusRef.current;
      if (toFocus && typeof toFocus.focus === 'function' && document.contains(toFocus)) {
        requestAnimationFrame(() => toFocus.focus());
      }
    };
  }, [onClose]);

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

  const submitWorkForm = async (e, i) => {
    e.preventDefault();
    const formElement = e.currentTarget;
    const form = workForms[i];
    const endInput = formElement.querySelector('input[name="end_time"]');

    if (endInput) {
      if (form.start_time && form.end_time && form.end_time <= form.start_time) {
        endInput.setCustomValidity('La hora de fin debe ser posterior a la hora de inicio.');
      } else {
        endInput.setCustomValidity('');
      }
    }

    if (!formElement.reportValidity()) return;
    await addWork(i);
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

  const toggleWorkNote = (workId) => {
    setOpenWorkNotes(prev => ({ ...prev, [workId]: !prev[workId] }));
  };

  const parsed = new Date(date + 'T00:00:00');
  const pretty = parsed.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  if (loading) return null;

  return (
    <dialog ref={dialogRef} className="modal-dialog" aria-labelledby="day-edit-modal-title">
      <div className="modal">
        <header className="modal-head">
          <div>
            <div id="day-edit-modal-title" className="modal-date">{pretty.charAt(0).toUpperCase() + pretty.slice(1)}</div>
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
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <div className="modal-body">
          {/* WORK */}
          <section className="panel">
            <h3>⏱ Horas de trabajo</h3>
            <ul className="list">
              {data.work.map(w => (
                <li key={w.id} className={`list-item ${openWorkNotes[w.id] ? 'note-open' : ''}`}>
                  <span className="swatch" style={{ background: w.project_color || '#4f8cff' }} />
                  <div className="li-main">
                    <div><b>{w.start_time} – {w.end_time}</b> <span className="muted">({fmtHours(diffMinutes(w.start_time, w.end_time))})</span></div>
                    <div className="muted small">{w.project_name || 'Sin proyecto'}</div>
                    {w.note && openWorkNotes[w.id] && <div className="day-entry-note">{w.note}</div>}
                  </div>
                  {w.note && (
                    <button
                      type="button"
                      className={`note-tri ${openWorkNotes[w.id] ? 'open' : ''}`}
                      onClick={() => toggleWorkNote(w.id)}
                      aria-expanded={!!openWorkNotes[w.id]}
                      title="Ver nota"
                    >▶</button>
                  )}
                  <button type="button" className="btn btn-link danger" onClick={async () => { await api.deleteWork(w.id); reload(); }}>Eliminar</button>
                </li>
              ))}
            </ul>

            <div className="work-forms">
              {workForms.map((form, i) => (
                <form key={i} className="work-form" onSubmit={(e) => submitWorkForm(e, i)}>
                  <input type="time" name="start_time" value={form.start_time}
                         required
                         onChange={e => updateWorkForm(i, 'start_time', e.target.value)} />
                  <span className="sep">→</span>
                  <input type="time" name="end_time" value={form.end_time}
                         required
                         onChange={e => updateWorkForm(i, 'end_time', e.target.value)} />
                  <FlowbiteDropdown
                    className="inline-select"
                    value={form.project_id}
                    onChange={(nextProject) => updateWorkForm(i, 'project_id', nextProject)}
                    options={[
                      { value: '', label: '— Proyecto —' },
                      ...projects.map(p => ({ value: String(p.id), label: p.name })),
                    ]}
                    ariaLabel="Proyecto"
                  />
                  <input type="text" placeholder="Nota"
                         maxLength={500}
                         value={form.note}
                         onChange={e => updateWorkForm(i, 'note', e.target.value)} />
                  <button type="submit" className="btn btn-primary">Añadir</button>
                  <button type="button" className="btn btn-ghost" onClick={() => removeWorkForm(i)}>Borrar</button>
                </form>
              ))}
            </div>
            <button type="button" className="btn btn-ghost" onClick={addWorkForm}>+ Otra entrada</button>
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
                  <button type="button" className="btn btn-link danger" onClick={async () => { await api.deleteTodo(t.id); reload(); }}>Eliminar</button>
                </li>
              ))}
            </ul>
            <form className="form-row" onSubmit={addTodo}>
              <input type="text" placeholder="Nueva tarea…" value={todoText} onChange={e => setTodoText(e.target.value)} required minLength={2} maxLength={160} />
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
                  <button type="button" className="btn btn-link danger" onClick={async () => { await api.deleteEvent(ev.id); reload(); }}>Eliminar</button>
                </li>
              ))}
            </ul>
            <form className="form-row" onSubmit={addEvent}>
              <FlowbiteDropdown
                className="inline-select"
                value={eventForm.kind}
                onChange={(nextKind) => setEventForm({ ...eventForm, kind: nextKind })}
                options={[
                  { value: 'event', label: 'Evento' },
                  { value: 'delivery', label: 'Entrega' },
                ]}
                ariaLabel="Tipo de evento"
              />
              <input type="text" placeholder="Título…" value={eventForm.title}
                required minLength={2} maxLength={160}
                     onChange={e => setEventForm({ ...eventForm, title: e.target.value })} />
              <button className="btn btn-primary" type="submit">Añadir</button>
            </form>
          </section>
        </div>
      </div>
    </dialog>
  );
}
