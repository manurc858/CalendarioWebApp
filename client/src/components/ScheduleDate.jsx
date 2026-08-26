import { CalendarDays, Check } from 'lucide-react';
import FlowbiteDateInput from './FlowbiteDateInput.jsx';

export default function ScheduleDate({ start, end, onChange }) {
  const apply = (field, value) => onChange?.({ start, end, [field]: value });
  return (
    <div className="schedule-date" aria-label="Rango de fechas de la tarea">
      <div className="schedule-date-heading"><CalendarDays size={16} /><span>Duración de la tarea</span></div>
      <div className="schedule-date-fields">
        <label>Inicio<FlowbiteDateInput value={start || ''} onValueChange={value => apply('start', value)} placeholder="Selecciona fecha" /></label>
        <span className="schedule-date-arrow">→</span>
        <label>Final<FlowbiteDateInput value={end || start || ''} min={start || undefined} onValueChange={value => apply('end', value)} placeholder="Selecciona fecha" /></label>
      </div>
      <div className="schedule-date-summary"><Check size={14} /> {start && end && start !== end ? 'Tarea de varios días' : 'Tarea de un día'}</div>
    </div>
  );
}
