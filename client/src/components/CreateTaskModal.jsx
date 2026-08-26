import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import FlowbiteDateInput from './FlowbiteDateInput.jsx';

// Modal "Nueva tarea" — mismo patrón de bottom sheet que CreateMeetingModal
export default function CreateTaskModal({ initialDate, onClose, onCreated }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [date, setDate] = useState(initialDate || '');
  const [text, setText] = useState('');
  const [extended, setExtended] = useState(false);
  const [endDate, setEndDate] = useState(initialDate || '');
  const [priority, setPriority] = useState('normal');

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;

    await api.createTodo({
      date: date || null,
      text: text.trim(),
      extended,
      end_date: extended ? (endDate || date || null) : null,
      priority: extended ? priority : 'normal',
    });
    onCreated?.();
    onCloseRef.current();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    restoreFocusRef.current = document.activeElement;
    if (!dialog.open) dialog.showModal();

    const onCancel = (e) => { e.preventDefault(); onCloseRef.current(); };
    const onBackdropClick = (e) => { if (e.target === dialog) onCloseRef.current(); };

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog ref={dialogRef} className="mn-editor-dialog" aria-labelledby="create-task-dialog-title">
      <div className="mn-editor mn-editor-sm">
        <div className="mn-editor-head">
          <h3 id="create-task-dialog-title">✅ Nueva tarea</h3>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Cerrar modal">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="cm-form">
          <div className="cm-field">
            <label>Tarea</label>
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Escribe la tarea…"
              className="inline-input"
              required
              minLength={2}
              autoFocus
            />
          </div>
          <div className="cm-field">
            <label>Fecha</label>
            <FlowbiteDateInput
              value={date}
              onValueChange={setDate}
              className="inline-input"
              placeholder="Selecciona fecha"
            />
          </div>
          <label className="cm-more-toggle">
            <span>Más información</span>
            <input type="checkbox" checked={extended} onChange={e => setExtended(e.target.checked)} />
          </label>
          {extended ? (
            <>
              <div className="cm-field">
                <label htmlFor="create-task-end">Fecha final</label>
                <FlowbiteDateInput
                  id="create-task-end"
                  value={endDate}
                  onValueChange={setEndDate}
                  min={date || undefined}
                  required
                  placeholder="Selecciona fecha"
                />
              </div>
              <div className="cm-field">
                <label htmlFor="create-task-priority">Prioridad</label>
                <select id="create-task-priority" value={priority} onChange={e => setPriority(e.target.value)}>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
            </>
          ) : null}
          <div className="mn-editor-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Crear</button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
