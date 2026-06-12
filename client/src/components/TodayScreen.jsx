import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import DayDetailPanel from './DayDetailPanel.jsx';
import { iso, LABOR_TYPES, effectiveLabor, calcMeetingHours } from '../utils.js';

// Pantalla "Hoy" del orbe central (móvil): hero con saludo, fecha grande y
// resumen del día + el detalle editable de siempre debajo.
export default function TodayScreen({ today, laborMap, projects, onReload, onClose }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const [stats, setStats] = useState(null);
  const dateIso = iso(today);

  useEffect(() => {
    api.getDay(dateIso).then(d => {
      const work = (d.work || []).reduce((a, w) => a + (w.hours || 0), 0);
      const meet = calcMeetingHours(d.meetings);
      setStats({
        hours: work + meet,
        pendientes: (d.todos || []).filter(t => !t.done).length,
        reuniones: (d.meetings || []).filter(m => m.attending !== false && m.attending !== 0).length,
      });
    }).catch(() => {});
  }, [dateIso]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    restoreFocusRef.current = document.activeElement;
    if (!dialog.open) dialog.showModal();

    const onCancel = (e) => {
      e.preventDefault();
      onClose();
    };

    dialog.addEventListener('cancel', onCancel);

    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (dialog.open) dialog.close();
      const toFocus = restoreFocusRef.current;
      if (toFocus && typeof toFocus.focus === 'function' && document.contains(toFocus)) {
        requestAnimationFrame(() => toFocus.focus());
      }
    };
  }, [onClose]);

  const h = today.getHours();
  const greeting = h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const eff = effectiveLabor(today, laborMap);
  const laborInfo = eff.type !== 'laborable' && eff.type !== 'finde' ? LABOR_TYPES[eff.type] : null;
  const dow = today.toLocaleDateString('es-ES', { weekday: 'long' });
  const monthYear = today.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  return (
    <dialog ref={dialogRef} className="today-screen-dialog" aria-label="Hoy">
      <div className="today-screen">
        <header className="today-hero">
          <button type="button" className="today-close" onClick={onClose} aria-label="Cerrar">✕</button>
          <div className="today-greeting">{greeting}</div>
          <div className="today-date-row">
            <span className="today-big-num">{today.getDate()}</span>
            <div className="today-date-info">
              <span className="today-dow">{dow}</span>
              <span className="today-monthyear">{monthYear}</span>
            </div>
          </div>
          {laborInfo && (
            <span
              className="today-labor-chip"
              style={{ background: laborInfo.color, color: laborInfo.text }}
            >
              {eff.label || laborInfo.label}
            </span>
          )}
          <div className="today-stats">
            <div className="today-stat">
              <strong>{stats ? `${stats.hours.toFixed(1)}h` : '·'}</strong>
              <span>registradas</span>
            </div>
            <div className="today-stat">
              <strong>{stats ? stats.pendientes : '·'}</strong>
              <span>tareas pend.</span>
            </div>
            <div className="today-stat">
              <strong>{stats ? stats.reuniones : '·'}</strong>
              <span>reuniones</span>
            </div>
          </div>
        </header>
        <div className="today-body">
          <DayDetailPanel
            key={dateIso}
            date={dateIso}
            laborMap={laborMap}
            projects={projects}
            onReload={onReload}
          />
        </div>
      </div>
    </dialog>
  );
}
