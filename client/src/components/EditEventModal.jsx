import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import FlowbiteDateInput from './FlowbiteDateInput.jsx';

export default function EditEventModal({ event, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [title, setTitle] = useState(event.title || '');
  const [date, setDate] = useState(event.date || '');
  const [kind, setKind] = useState(event.kind || 'event');

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const onCancel = e => { e.preventDefault(); onCloseRef.current(); };
    const onBackdrop = e => { if (e.target === dialog) onCloseRef.current(); };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdrop);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onBackdrop);
      if (dialog.open) dialog.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async e => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;
    await api.updateEvent(event.id, { title: title.trim(), date, kind });
    onSaved?.();
    onCloseRef.current();
  };

  return (
    <dialog ref={dialogRef} className="mn-editor-dialog" aria-labelledby="edit-event-title">
      <div className="mn-editor mn-editor-sm">
        <div className="mn-editor-head">
          <h3 id="edit-event-title">Editar {kind === 'delivery' ? 'entrega' : 'evento'}</h3>
          <button type="button" className="btn btn-icon btn-ghost" onClick={() => onCloseRef.current()} aria-label="Cerrar modal">✕</button>
        </div>
        <form onSubmit={submit} className="cm-form">
          <div className="cm-field">
            <label htmlFor="edit-event-name">Nombre</label>
            <input id="edit-event-name" className="inline-input" value={title} onChange={e => setTitle(e.target.value)} required minLength={2} maxLength={160} autoFocus />
          </div>
          <div className="cm-field">
            <label htmlFor="edit-event-kind">Tipo</label>
            <select id="edit-event-kind" value={kind} onChange={e => setKind(e.target.value)}>
              <option value="event">Evento</option>
              <option value="delivery">Entrega</option>
            </select>
          </div>
          <div className="cm-field">
            <label htmlFor="edit-event-date">Fecha</label>
            <FlowbiteDateInput id="edit-event-date" value={date} onValueChange={setDate} required placeholder="Selecciona fecha" />
          </div>
          <div className="mn-editor-foot">
            <button type="button" className="btn btn-ghost" onClick={() => onCloseRef.current()}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!title.trim() || !date}>Guardar</button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
