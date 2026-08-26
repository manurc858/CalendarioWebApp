import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import FlowbiteDateInput from './FlowbiteDateInput.jsx';

export default function EditTaskModal({ todo, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [text, setText] = useState(todo.text || '');
  const [endDate, setEndDate] = useState(todo.end_date || todo.date || '');
  const [priority, setPriority] = useState(todo.priority || 'normal');

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onCancel = event => { event.preventDefault(); onCloseRef.current(); };
    const onBackdrop = event => { if (event.target === dialog) onCloseRef.current(); };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdrop);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onBackdrop);
      if (dialog.open) dialog.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async event => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    await api.updateTodo(todo.id, {
      text: text.trim(),
      end_date: todo.extended ? (endDate || todo.date || null) : null,
      priority: todo.extended ? priority : 'normal',
    });
    onSaved?.();
    onCloseRef.current();
  };

  return (
    <dialog ref={dialogRef} className="mn-editor-dialog" aria-labelledby="edit-task-title">
      <div className="mn-editor mn-editor-sm">
        <div className="mn-editor-head">
          <h3 id="edit-task-title">Editar tarea</h3>
          <button type="button" className="btn btn-icon btn-ghost" onClick={onClose} aria-label="Cerrar modal">✕</button>
        </div>
        <form onSubmit={submit} className="cm-form">
          <div className="cm-field">
            <label htmlFor="edit-task-name">Nombre</label>
            <input id="edit-task-name" className="inline-input" value={text} onChange={event => setText(event.target.value)} required minLength={2} maxLength={160} autoFocus />
          </div>
          {todo.extended ? (
            <>
              <div className="cm-field">
                <label>Fecha de inicio</label>
                <FlowbiteDateInput value={todo.date || ''} disabled placeholder="Selecciona fecha" />
              </div>
              <div className="cm-field">
                <label htmlFor="edit-task-end">Fecha final</label>
                <FlowbiteDateInput
                  id="edit-task-end"
                  value={endDate}
                  onValueChange={setEndDate}
                  min={todo.date || undefined}
                  required
                  placeholder="Selecciona fecha"
                />
              </div>
              <div className="cm-field">
                <label htmlFor="edit-task-priority">Prioridad</label>
                <select id="edit-task-priority" value={priority} onChange={event => setPriority(event.target.value)}>
                  <option value="normal">Normal</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
            </>
          ) : null}
          <div className="mn-editor-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!text.trim()}>Guardar</button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
