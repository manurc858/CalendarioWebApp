import { useMemo, useState, useEffect } from 'react';
import { LABOR_TYPES, MONTH_NAMES, iso, isWeekend, calcMeetingHours } from '../utils.js';
import { api } from '../api.js';

export default function YearView({
  year, laborMap, activeType, onChange, onJump
}) {
  const [painting, setPainting] = useState(false);
  const [popup, setPopup] = useState(null); // { date, data, x, y }
  const [loading, setLoading] = useState(false);
  const [eventDates, setEventDates] = useState(new Set());

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

  // Close popup on Escape
  useEffect(() => {
    const fn = (e) => { if (e.key === 'Escape') setPopup(null); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const handleClick = async (d, e) => {
    if (!d) return;
    const key = iso(d);

    if (painting) {
      const current = laborMap[key];
      if (current?.type === activeType) onChange(key, null);
      else onChange(key, activeType);
    } else {
      // Open day detail popup
      setLoading(true);
      setPopup(null);
      try {
        const data = await api.getDay(key);
        // Position near the click but within viewport
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let x = e.clientX + 12;
        let y = e.clientY + 12;
        if (x + 360 > vw) x = vw - 370;
        if (y + 300 > vh) y = vh - 310;
        if (x < 10) x = 10;
        if (y < 10) y = 10;
        setPopup({ date: key, data, x, y });
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
          onClick={() => { setPainting(p => !p); setPopup(null); }}
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

      {/* Day detail popup */}
      {popup && (() => {
        const pd = new Date(popup.date + 'T00:00:00');
        const pdow = pd.getDay();
        const pTarget = (pdow >= 1 && pdow <= 4) ? 8.75 : pdow === 5 ? 6 : 0;
        const pWork = popup.data.work.reduce((a, w) => a + (w.hours || 0), 0);
        const pMeet = calcMeetingHours(popup.data.meetings);
        const pTotal = pWork + pMeet;
        const pPct = pTarget > 0 ? Math.min(100, (pTotal / pTarget) * 100) : 0;
        const prettyDate = pd.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

        return (
        <>
          <div className="yv-popup-overlay" onClick={() => setPopup(null)} />
          <div className="yv-popup" style={{ left: popup.x, top: popup.y }}>
            <div className="yv-popup-head">
              <span className="yv-popup-date">{prettyDate.charAt(0).toUpperCase() + prettyDate.slice(1)}</span>
              <button className="yv-popup-close" onClick={() => setPopup(null)}>✕</button>
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
                <div className="yv-popup-label">🕐 Horarios</div>
                {popup.data.work.length === 0
                  ? <span className="yv-popup-empty">Sin registros</span>
                  : popup.data.work.map(w => (
                    <div key={w.id} className="yv-popup-work-item">
                      <div className="yv-popup-work-top">
                        <span className="yv-popup-work-swatch" style={{ background: w.project_color || '#4f8cff' }} />
                        <span className="yv-popup-proj">{w.project_name || 'Sin proyecto'}</span>
                        <span className="yv-popup-hours">{w.hours}h</span>
                        {w.note && <button className="note-tri" onClick={e => e.currentTarget.closest('.yv-popup-work-item').classList.toggle('note-open')} title="Ver nota">▶</button>}
                      </div>
                      {w.note && <div className="yv-popup-work-note">{w.note}</div>}
                    </div>
                  ))
                }
              </div>

              {/* Todos */}
              <div className="yv-popup-section">
                <div className="yv-popup-label">✅ Tareas</div>
                {popup.data.todos.length === 0
                  ? <span className="yv-popup-empty">Sin tareas</span>
                  : popup.data.todos.map(t => (
                    <div key={t.id} className={`yv-popup-row ${t.done ? 'done' : ''}`}>
                      <span>{t.done ? '☑' : '☐'} {t.text}</span>
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
                    <div key={i} className="yv-popup-row">
                      <span>{mt.title}</span>
                      {mt.startTime && <span className="yv-popup-time">{mt.startTime}–{mt.endTime}</span>}
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </>
        );
      })()}
    </div>
  );
}
