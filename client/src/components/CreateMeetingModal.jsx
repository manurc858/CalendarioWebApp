import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import FlowbiteDateInput from './FlowbiteDateInput.jsx';

export default function CreateMeetingModal({ initialDate, onClose, onCreated }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const endTimeRef = useRef(null);
  const [date, setDate] = useState(initialDate || '');
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState('');

  useEffect(() => {
    const endInput = endTimeRef.current;
    if (!endInput) return;

    if (allDay || !startTime || !endTime || endTime > startTime) {
      endInput.setCustomValidity('');
      return;
    }

    endInput.setCustomValidity('La hora de fin debe ser posterior a la hora de inicio.');
  }, [allDay, startTime, endTime]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!e.currentTarget.reportValidity()) return;

    await api.createCustomMeeting({
      date,
      title: title.trim(),
      start_time: allDay ? null : startTime || null,
      end_time: allDay ? null : endTime || null,
      all_day: allDay,
      repeat: repeatWeekly ? 'weekly' : 'none',
      repeat_until: repeatWeekly ? (repeatUntil || null) : null,
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
    <dialog ref={dialogRef} className="mn-editor-dialog" aria-labelledby="create-meeting-dialog-title">
      <div className="mn-editor mn-editor-sm">
        <div className="mn-editor-head">
          <h3 id="create-meeting-dialog-title">📅 Nueva reunión</h3>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Cerrar modal">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="cm-form">
          <div className="cm-field">
            <label>Título</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Nombre de la reunión…"
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
              required
              placeholder="Selecciona fecha"
            />
          </div>
          <div className="cm-field cm-checkbox">
            <label>
              <input
                type="checkbox"
                checked={allDay}
                onChange={e => setAllDay(e.target.checked)}
              />
              Todo el día
            </label>
          </div>
          {!allDay && (
            <div className="cm-row">
              <div className="cm-field">
                <label>Inicio</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="inline-input"
                  required={!allDay}
                />
              </div>
              <div className="cm-field">
                <label>Fin</label>
                <input
                  ref={endTimeRef}
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="inline-input"
                  required={!allDay}
                />
              </div>
            </div>
          )}
          <div className="cm-field cm-checkbox">
            <label>
              <input
                type="checkbox"
                checked={repeatWeekly}
                onChange={e => setRepeatWeekly(e.target.checked)}
              />
              Repetir cada semana
            </label>
          </div>
          {repeatWeekly && (
            <div className="cm-field">
              <label>Repetir hasta (opcional)</label>
              <FlowbiteDateInput
                value={repeatUntil}
                onValueChange={setRepeatUntil}
                className="inline-input"
                placeholder="Sin fecha fin"
              />
            </div>
          )}
          <div className="mn-editor-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!title.trim() || !date}>Crear</button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
