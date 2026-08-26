import { useState } from 'react';
import { CalendarDays, CircleAlert, Clock3, ListTodo, UsersRound } from 'lucide-react';
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
          const pendingTodoCount = summary?.todos?.filter(todo => !todo.done).length || 0;
          const eventCount = summary?.events?.length || 0;
          const meetingCount = summary?.meetings?.length || 0;
          const isWorkday = eff.type === 'laborable';
          const isFuture = new Date(dIso + 'T00:00:00') > today;
          const isMissingWork = isWorkday && !isFuture && !hasWork;
          const ariaLabel = [
            date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }),
            eff.label || null,
            hasWork ? `${totalHours.toFixed(1)} horas computadas` : null,
            isMissingWork ? 'sin horas registradas' : null,
            pendingTodoCount ? `${pendingTodoCount} ${pendingTodoCount === 1 ? 'tarea pendiente' : 'tareas pendientes'}` : null,
            eventCount ? `${eventCount} ${eventCount === 1 ? 'evento' : 'eventos'}` : null,
            meetingCount ? `${meetingCount} ${meetingCount === 1 ? 'reunión' : 'reuniones'}` : null,
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
                      ? (
                        <span className="cal-icon cal-icon-hours" title={`${totalHours.toFixed(1)} horas computadas`}>
                          <Clock3 aria-hidden="true" />
                          <span>{totalHours.toFixed(1)}h</span>
                        </span>
                      )
                      : (isMissingWork && (
                        <span className="cal-icon cal-icon-missing" title="Sin horas registradas">
                          <CircleAlert aria-hidden="true" />
                          <span>0h</span>
                        </span>
                      ))
                    }
                    {pendingTodoCount > 0 && (
                      <span className="cal-icon cal-icon-todo" title={`${pendingTodoCount} ${pendingTodoCount === 1 ? 'tarea pendiente' : 'tareas pendientes'}`}>
                        <ListTodo aria-hidden="true" />
                        <span className="cal-icon-count">{pendingTodoCount}</span>
                      </span>
                    )}
                    {eventCount > 0 && (
                      <span className="cal-icon cal-icon-event" title={`${eventCount} ${eventCount === 1 ? 'evento' : 'eventos'}`}>
                        <CalendarDays aria-hidden="true" />
                        <span className="cal-icon-count">{eventCount}</span>
                      </span>
                    )}
                    {meetingCount > 0 && (
                      <span className="cal-icon cal-icon-meeting" title={`${meetingCount} ${meetingCount === 1 ? 'reunión' : 'reuniones'}`}>
                        <UsersRound aria-hidden="true" />
                        <span className="cal-icon-count">{meetingCount}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </button>
          );
        }))}
      </div>
    </div>
  );
}
