import { useMemo, useState } from 'react';
import { LABOR_TYPES, MONTH_NAMES, iso, isWeekend } from '../utils.js';

const isTodoDrag = e => e.dataTransfer.types.includes('application/x-todo-id');

// Resumen del mes con el mismo estilo que cada mes de la vista anual
export default function WeeklyMonthSummary({
  monthIso, selectedIso, todayIso, laborMap, eventDates, hoursByDay, onSelect, onDropTodo
}) {
  const [y, m] = monthIso.split('-').map(Number);
  const [dropTarget, setDropTarget] = useState(null);

  const days = useMemo(() => {
    const arr = [];
    const last = new Date(y, m, 0).getDate();
    const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    for (let i = 0; i < offset; i++) arr.push(null);
    for (let d = 1; d <= last; d++) arr.push(new Date(y, m - 1, d));
    return arr;
  }, [y, m]);

  return (
    <section className="day-section wv-month-summary">
      <div className="year-month-card">
        <div className="year-month-title wv-month-summary-title">{MONTH_NAMES[m - 1]} {y}</div>
        <div className="year-dow">
          {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => (
            <span key={i} className="year-dow-cell">{d}</span>
          ))}
        </div>
        <div className="year-day-grid">
          {days.map((d, i) => {
            if (!d) return <span key={i} className="year-day empty" />;
            const key = iso(d);
            const info = laborMap[key];
            const label = info?.label || (isWeekend(d) ? 'Fin de semana' : '');
            const effectiveType = info?.type || (isWeekend(d) ? 'finde' : 'laborable');
            const isSpecial = effectiveType !== 'laborable';
            const typeInfo = LABOR_TYPES[effectiveType];
            const style = isSpecial
              ? { '--day-color': typeInfo.color, '--day-text': typeInfo.text, color: typeInfo.text }
              : { background: typeInfo.color, color: typeInfo.text };
            const dayHours = hoursByDay[key] || 0;
            const heat = dayHours <= 0 ? 0 : dayHours < 3 ? 1 : dayHours < 6 ? 2 : dayHours < 8 ? 3 : 4;
            const hoursLabel = dayHours > 0 ? `${Math.round(dayHours * 10) / 10} h registradas` : '';
            return (
              <button
                key={i}
                type="button"
                className={`year-day ${key === todayIso ? 'yv-today' : ''} ${key === selectedIso ? 'wv-month-selected' : ''} ${isSpecial ? 'special' : ''} ${eventDates.has(key) ? 'has-event' : ''} ${dropTarget === key ? 'drop-hover' : ''}`}
                style={style}
                title={[label, hoursLabel].filter(Boolean).join(' · ')}
                aria-pressed={key === selectedIso}
                onClick={() => onSelect(key)}
                onDragOver={e => {
                  if (!onDropTodo || !isTodoDrag(e)) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dropTarget !== key) setDropTarget(key);
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={e => {
                  e.preventDefault();
                  setDropTarget(null);
                  const todoId = Number(e.dataTransfer.getData('application/x-todo-id'));
                  if (todoId && onDropTodo) onDropTodo(todoId, key, e.dataTransfer.getData('application/x-todo-date'));
                }}
              >
                {d.getDate()}
                {eventDates.has(key) && <span className="yv-event-dot" />}
                {heat > 0 && <span className="yv-heat" data-level={heat} />}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
