import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { diffMinutes, fmtHours, LABOR_TYPES, effectiveLabor } from '../utils.js';

export default function DayPopover({ date, anchor, onClose, onEdit, laborMap }) {
  const [data, setData] = useState({ work: [], todos: [], events: [] });
  const [loading, setLoading] = useState(true);
  const popoverRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const effectiveType = effectiveLabor(new Date(date + 'T00:00:00'), laborMap);

  useEffect(() => {
    (async () => {
      setData(await api.getDay(date));
      setLoading(false);
    })();
  }, [date]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const popover = popoverRef.current;
    if (!popover) return;

    const onToggle = (event) => {
      if (event.newState === 'closed') onClose();
    };

    popover.addEventListener('toggle', onToggle);
    requestAnimationFrame(() => {
      if (typeof popover.showPopover === 'function' && !popover.matches(':popover-open')) {
        popover.showPopover();
      }
      popover.focus();
    });

    return () => {
      popover.removeEventListener('toggle', onToggle);
      if (typeof popover.hidePopover === 'function' && popover.matches(':popover-open')) {
        popover.hidePopover();
      }
      const toFocus = restoreFocusRef.current;
      if (toFocus && typeof toFocus.focus === 'function' && document.contains(toFocus)) {
        requestAnimationFrame(() => toFocus.focus());
      }
    };
  }, [onClose]);

  const totalMin = data.work.reduce((a, w) => a + diffMinutes(w.start_time, w.end_time), 0);

  if (loading) return null;

  const parsed = new Date(date + 'T00:00:00');
  const pretty = parsed.toLocaleDateString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short'
  }).split('/').join('-');
  const titleId = `day-popover-title-${date}`;

  // Position popover
  const style = {
    position: 'fixed',
    top: (anchor?.top || 0) + (anchor?.height || 0) + 8,
    left: (anchor?.left || 0),
    zIndex: 40,
  };

  return (
    <div
      ref={popoverRef}
      className="popover"
      style={style}
      popover="auto"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <div className="popover-head">
        <div>
          <div id={titleId} className="popover-date">{pretty}</div>
          {effectiveType.label && (
            <div className="popover-labor"
                 style={{ background: LABOR_TYPES[effectiveType.type].color, color: LABOR_TYPES[effectiveType.type].text }}>
              {LABOR_TYPES[effectiveType.type].label}
            </div>
          )}
        </div>
        <div className="popover-total">
          <strong>{fmtHours(totalMin)}</strong>
        </div>
      </div>

      <div className="popover-body">
        {data.work.length > 0 && (
          <div className="pop-section">
            <div className="pop-title">⏱ Horas</div>
            <ul className="pop-list">
              {data.work.map(w => (
                <li key={w.id}>
                  <span className="swatch" style={{ background: w.project_color || '#4f8cff' }} />
                  <div>
                    <strong>{w.start_time}–{w.end_time}</strong>
                    <div className="pop-sub">{w.project_name || 'Sin proyecto'}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {data.todos.filter(t => !t.done).length > 0 && (
          <div className="pop-section">
            <div className="pop-title">✅ Tareas</div>
            <ul className="pop-list">
              {data.todos.filter(t => !t.done).map(t => (
                <li key={t.id}>{t.text}</li>
              ))}
            </ul>
          </div>
        )}

        {data.events.length > 0 && (
          <div className="pop-section">
            <div className="pop-title">📌 Eventos</div>
            <ul className="pop-list">
              {data.events.map(e => (
                <li key={e.id}>{e.kind === 'delivery' ? '📦' : '🎯'} {e.title}</li>
              ))}
            </ul>
          </div>
        )}

        {data.work.length === 0 && data.todos.length === 0 && data.events.length === 0 && (
          <div className="pop-empty">Sin entradas</div>
        )}
      </div>

      <div className="popover-foot">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cerrar</button>
        <button type="button" className="btn btn-primary" onClick={onEdit}>✎ Editar</button>
      </div>
    </div>
  );
}
