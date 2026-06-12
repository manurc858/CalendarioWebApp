import { useState } from 'react';
import { monthMatrix, DOW, iso, LABOR_TYPES, effectiveLabor, calcMeetingHours } from '../utils.js';

export default function Calendar({ cursor, today, onSelect, laborMap, daySummaries, selectedDay, onDropTodo }) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const weeks = monthMatrix(year, month);
  const todayIso = iso(today);
  const [dropTarget, setDropTarget] = useState(null);

  return (
    <div className="calendar compact">
      <div className="cal-head">
        {DOW.map(d => <div key={d} className="cal-head-cell">{d}</div>)}
      </div>
      <div className="cal-grid">
        {weeks.map((week, wi) => week.map((date, di) => {
          const dIso = iso(date);
          const inMonth = date.getMonth() === month;
          const eff = effectiveLabor(date, laborMap);
          const summary = daySummaries[dIso];
          const workHours = summary?.work?.reduce((a, w) => a + (w.hours || 0), 0) || 0;
          const meetHours = calcMeetingHours(summary?.meetings);
          const totalHours = workHours + meetHours;
          const laborInfo = LABOR_TYPES[eff.type];
          const isSpecial = eff.type !== 'laborable';
          const laborStyle = isSpecial
            ? {
                '--day-color': laborInfo?.color,
                '--day-text': laborInfo?.text,
                color: laborInfo?.text,
              }
            : { background: laborInfo?.color, color: laborInfo?.text };
          const isToday = dIso === todayIso;
          const isSelected = dIso === selectedDay;
          const hasWork = totalHours > 0;
          const hasTodos = summary?.todos?.length > 0;
          const hasEvents = summary?.events?.length > 0;
          const hasMeetings = summary?.meetings?.length > 0;
          const isWorkday = eff.type === 'laborable';
          const isFuture = new Date(dIso + 'T00:00:00') > today;
          const ariaLabel = [
            date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }),
            eff.label || null,
            totalHours > 0 ? `${totalHours.toFixed(1)} horas` : null,
            hasTodos ? 'con tareas' : null,
            hasEvents ? 'con eventos' : null,
            hasMeetings ? 'con reuniones' : null,
          ].filter(Boolean).join(', ');

          return (
            <button
              type="button"
              key={`${wi}-${di}`}
              className={`cal-cell ${inMonth ? '' : 'out'} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${dropTarget === dIso ? 'drop-hover' : ''} ${isSpecial ? 'special' : ''} cal-cell-${eff.type}`}
              onClick={() => onSelect(dIso)}
              style={laborStyle}
              title={eff.label || ''}
              aria-label={ariaLabel}
              onDragOver={e => {
                if (onDropTodo) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropTarget(dIso);
                }
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={e => {
                e.preventDefault();
                setDropTarget(null);
                const todoId = e.dataTransfer.getData('application/x-todo-id');
                if (todoId && onDropTodo) onDropTodo(Number(todoId), dIso);
              }}
            >
              <div className="cal-cell-inner">
                <span className="cal-day-num">{date.getDate()}</span>
                {eff.label && <div className="cal-label"><span>{eff.label}</span></div>}
                {inMonth && (
                  <div className="cal-icons">
                    {hasWork
                      ? <span className="cal-icon work" title={`${totalHours.toFixed(2)}h`}>🕐</span>
                      : (isWorkday && !isFuture && <span className="cal-icon no-work" title="Sin horas">🕐</span>)
                    }
                    {hasTodos && <span className="cal-icon todo" title="Tareas">✅</span>}
                    {hasEvents && <span className="cal-icon event" title="Eventos">📌</span>}
                    {hasMeetings && <span className="cal-icon meeting" title={`${summary.meetings.length} reunión(es)`}>📞</span>}
                  </div>
                )}
                {totalHours > 0 && (
                  <div className="cal-total">{totalHours.toFixed(1)}h</div>
                )}
              </div>
            </button>
          );
        }))}
      </div>
    </div>
  );
}
