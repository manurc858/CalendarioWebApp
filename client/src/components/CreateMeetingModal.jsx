import { useState } from 'react';
import { api } from '../api.js';

export default function CreateMeetingModal({ initialDate, onClose, onCreated }) {
  const [date, setDate] = useState(initialDate || '');
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [allDay, setAllDay] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!date || !title.trim()) return;
    await api.createCustomMeeting({
      date,
      title: title.trim(),
      start_time: allDay ? null : startTime || null,
      end_time: allDay ? null : endTime || null,
      all_day: allDay,
    });
    onCreated?.();
    onClose();
  };

  return (
    <div className="mn-editor-overlay" onClick={onClose}>
      <div className="mn-editor mn-editor-sm" onClick={e => e.stopPropagation()}>
        <div className="mn-editor-head">
          <h3>📅 Nueva reunión</h3>
          <button className="btn btn-icon" onClick={onClose}>✕</button>
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
              autoFocus
            />
          </div>
          <div className="cm-field">
            <label>Fecha</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="inline-input"
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
                />
              </div>
              <div className="cm-field">
                <label>Fin</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="inline-input"
                />
              </div>
            </div>
          )}
          <div className="mn-editor-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={!title.trim() || !date}>Crear</button>
          </div>
        </form>
      </div>
    </div>
  );
}
