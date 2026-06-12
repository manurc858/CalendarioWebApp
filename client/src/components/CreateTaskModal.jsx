import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import FlowbiteDateInput from './FlowbiteDateInput.jsx';

// Modal "Nueva tarea" — mismo patrón de bottom sheet que CreateMeetingModal
export default function CreateTaskModal({ initialDate, onClose, onCreated }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const [date, setDate] = useState(initialDate || '');
  const [text, setText] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;

    await api.createTodo({
      date: date || null,
      text: text.trim(),
    });
    onCreated?.();
    onClose();
  };

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
          <div className="mn-editor-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Crear</button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
