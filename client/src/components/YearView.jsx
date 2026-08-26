import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { LABOR_TYPES, MONTH_NAMES, iso, isWeekend, calcMeetingHours } from '../utils.js';
import { api } from '../api.js';
import TaskLabel from './TaskLabel.jsx';

export default function YearView({
  year, laborMap, activeType, onChange, onJump, onDayPeek, onReload
}) {
  const [painting, setPainting] = useState(false);
  const [popup, setPopup] = useState(null); // { date, data, title }
  const [openWorkNotes, setOpenWorkNotes] = useState({});
  const [loading, setLoading] = useState(false);
  const [eventDates, setEventDates] = useState(new Set());
  const dialogRef = useRef(null);

  const closePopup = useCallback(() => {
    setPopup(null);
  }, []);

  // Load events for the whole year to show dots
  useEffect(() => {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    api.listEvents({ from, to }).then(events => {
      const dates = new Set();
      events.forEach(e => dates.add(e.date));
      setEventDates(dates);
    });
  }, [year]);

  const months = useMemo(() => {
    const arr = [];
    for (let m = 0; m < 12; m++) {
      const days = [];
      const last = new Date(year, m + 1, 0).getDate();
      const first = new Date(year, m, 1);
      const offset = (first.getDay() + 6) % 7;
      for (let i = 0; i < offset; i++) days.push(null);
      for (let d = 1; d <= last; d++) days.push(new Date(year, m, d));
      arr.push(days);
    }
    return arr;
  }, [year]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (popup && !dialog.open) dialog.showModal();
    if (!popup && dialog.open) dialog.close();
    const onCancel = e => { e.preventDefault(); closePopup(); };
    const onClick = e => { if (e.target === dialog) closePopup(); };
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onClick);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onClick);
    };
  }, [popup, closePopup]);

  useEffect(() => {
    setOpenWorkNotes({});
  }, [popup?.date]);

  const toggleWorkNote = (workId) => {
    setOpenWorkNotes(prev => ({ ...prev, [workId]: !prev[workId] }));
  };

  const handleClick = async (d, e) => {
    if (!d) return;
    const key = iso(d);

    if (painting) {
      const current = laborMap[key];
      if (current?.type === activeType) onChange(key, null);
      else onChange(key, activeType);
    } else if (onDayPeek && window.matchMedia('(max-width: 768px)').matches) {
      // Móvil: bottom sheet con el detalle del día (igual que la vista mensual)
      onDayPeek(key);
    } else {
      setLoading(true);
      try {
        const data = await api.getDay(key);
        const title = new Date(key + 'T00:00:00')
          .toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
        setPopup({ date: key, data, title });
      } catch { /* ignore */ }
      setLoading(false);
    }
  };

  const todayIso = iso(new Date());

  return (
    <div className="year-view">
      {/* Pincel toggle */}
      <div className="yv-toolbar">
        <button
          className={`yv-pincel-btn ${painting ? 'active' : ''}`}
          onClick={() => { setPainting(p => !p); closePopup(); }}
        >
          🖌️ {painting ? 'Pincel activo' : 'Activar pincel'}
        </button>
        {painting && (
          <span className="yv-pincel-hint">
            Tipo: <strong style={{ color: LABOR_TYPES[activeType]?.text, background: LABOR_TYPES[activeType]?.color, padding: '2px 8px', borderRadius: 6 }}>{LABOR_TYPES[activeType]?.label}</strong>
            — Pulsa un día para aplicar / quitar
          </span>
        )}
      </div>

      <div className="year-grid">
        {months.map((days, m) => (
          <div key={m} className="year-month-card">
            <button className="year-month-title" onClick={() => onJump(new Date(year, m, 1))}>
              {MONTH_NAMES[m]}
            </button>
            <div className="year-dow">
              {['L','M','X','J','V','S','D'].map((d, i) => (
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
                  ? {
                      '--day-color': typeInfo.color,
                      '--day-text': typeInfo.text,
                      color: typeInfo.text,
                    }
                  : { background: typeInfo.color, color: typeInfo.text };
                const isToday = key === todayIso;
                const hasEvent = eventDates.has(key);
                return (
                  <button
                    key={i}
                    className={`year-day ${painting ? 'painting' : ''} ${isToday ? 'yv-today' : ''} ${isSpecial ? 'special' : ''} ${hasEvent ? 'has-event' : ''}`}
                    style={style}
                    title={label}
                    onClick={(e) => handleClick(d, e)}
                  >
                    {d.getDate()}
                    {hasEvent && <span className="yv-event-dot" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Day detail dialog */}
      <dialog ref={dialogRef} className="yv-dialog" aria-labelledby="yv-dialog-title">
        {popup && (() => {
        const pd = new Date(popup.date + 'T00:00:00');
        const pdow = pd.getDay();
        const pTarget = (pdow >= 1 && pdow <= 4) ? 8.75 : pdow === 5 ? 6 : 0;
        const pWork = popup.data.work.reduce((a, w) => a + (w.hours || 0), 0);
        const pMeet = calcMeetingHours(popup.data.meetings);
        const pTotal = pWork + pMeet;
        const pPct = pTarget > 0 ? Math.min(100, (pTotal / pTarget) * 100) : 0;
        const prettyDate = popup.title;
        const popupTitleId = 'yv-dialog-title';

        return (
        <>
          <div className="yv-popup">
            <div className="yv-popup-head">
              <span id={popupTitleId} className="yv-popup-date">{prettyDate.charAt(0).toUpperCase() + prettyDate.slice(1)}</span>
              <button type="button" className="yv-popup-close" onClick={closePopup} aria-label="Cerrar detalle del día">✕</button>
            </div>
            {pTarget > 0 && (
              <div className="day-progress" style={{ margin: '0', borderRadius: 0, borderBottom: '1px solid var(--line)' }}>
                <div className="day-progress-bar">
                  <div
                    className={`day-progress-fill ${pPct >= 100 ? 'complete' : pPct >= 50 ? 'half' : ''}`}
                    style={{ width: `${pPct}%` }}
                  />
                </div>
                <span className="day-progress-label">{pTotal.toFixed(2)} / {pTarget}h</span>
              </div>
            )}
            <div className="yv-popup-body">
              {/* Work */}
              <div className="yv-popup-section">
                <div className="yv-popup-label">🕐 Horas</div>
                {popup.data.work.length === 0
                  ? <span className="yv-popup-empty">Sin registros</span>
                  : popup.data.work.map(w => {
                    const isOpen = !!openWorkNotes[w.id];
                    return (
                    <div key={w.id} className="yv-card">
                      <div className="yv-card-bar" style={{ background: w.project_color || '#4f8cff' }} />
                      <div className="yv-card-body">
                        <span className="yv-card-title">{w.project_name || 'Sin proyecto'}</span>
                        {w.note && <span className="yv-card-sub">{w.note}</span>}
                      </div>
                      <span className="yv-card-badge">{w.hours}h</span>
                    </div>
                    );
                  })
                }
              </div>

              {/* Todos */}
              <div className="yv-popup-section">
                <div className="yv-popup-label">✅ Tareas</div>
                {popup.data.todos.length === 0
                  ? <span className="yv-popup-empty">Sin tareas</span>
                  : popup.data.todos.map(t => (
                    <div key={t.id} className={`yv-popup-row ${t.done ? 'done' : ''}`}>
                      <TaskLabel todo={t} onChanged={async () => {
                        const data = await api.getDay(popup.date);
                        setPopup(prev => prev ? { ...prev, data } : prev);
                        onReload?.();
                      }} />
                    </div>
                  ))
                }
              </div>

              {/* Events */}
              <div className="yv-popup-section">
                <div className="yv-popup-label">📌 Eventos</div>
                {popup.data.events.length === 0
                  ? <span className="yv-popup-empty">Sin eventos</span>
                  : popup.data.events.map(ev => (
                    <div key={ev.id} className="yv-popup-row yv-popup-event-row">
                      <span>{ev.title}</span>
                      <span className="yv-popup-kind">{ev.kind}</span>
                    </div>
                  ))
                }
              </div>

              {/* Meetings */}
              <div className="yv-popup-section">
                <div className="yv-popup-label">📞 Reuniones</div>
                {popup.data.meetings.length === 0
                  ? <span className="yv-popup-empty">Sin reuniones</span>
                  : popup.data.meetings.map((mt, i) => (
                    <div key={i} className="yv-card" style={{ '--meeting-color': mt.project_color || (mt.isCustom ? '#a78bfa' : '#94a3b8') }}>
                      <div className="yv-card-bar" style={{ background: 'var(--meeting-color)' }} />
                      <div className="yv-card-body">
                        <span className="yv-card-title">{mt.title}</span>
                        {mt.startTime && <span className="yv-card-sub">{mt.startTime}{mt.endTime ? `–${mt.endTime}` : ''}</span>}
                      </div>
                      {mt.attending === false || mt.attending === 0
                        ? <span className="yv-card-att absent" title="No asiste">✕</span>
                        : <span className="yv-card-att attending" title="Asiste">✓</span>}
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </>
        );
      })()}
      </dialog>
    </div>
  );
}
