import { useMemo, useState } from 'react';
import { LABOR_TYPES, LABOR_ORDER, MONTH_NAMES, iso, isWeekend } from '../utils.js';

export default function YearSidebar({
  year, laborMap, onChange, onJump
}) {
  const [activeType, setActiveType] = useState('vacaciones');

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

  const handleClick = (d) => {
    if (!d) return;
    const key = iso(d);
    const current = laborMap[key];
    if (current?.type === activeType) onChange(key, null);
    else onChange(key, activeType);
  };

  return (
    <div className="sidebar-section">
      <div className="legend">
        <div className="legend-title">Pincel · pulsa para aplicar</div>
        {LABOR_ORDER.filter(t => t !== 'laborable' && t !== 'finde').map(t => (
          <button key={t}
            className={`legend-item ${activeType === t ? 'active' : ''}`}
            onClick={() => setActiveType(t)}>
            <span className="legend-swatch" style={{ background: LABOR_TYPES[t].color, borderColor: LABOR_TYPES[t].text }} />
            <span>{LABOR_TYPES[t].label}</span>
          </button>
        ))}
        <div className="legend-hint">Pulsa de nuevo para borrar.</div>
      </div>

      <div className="mini-months">
        {months.map((days, m) => (
          <div key={m} className="mini-month">
            <button className="mini-month-title" onClick={() => onJump(new Date(year, m, 1))}>
              {MONTH_NAMES[m]}
            </button>
            <div className="mini-dow">
              {['L','M','X','J','V','S','D'].map((d, i) => (
                <span key={i} className="mini-dow-cell">{d}</span>
              ))}
            </div>
            <div className="mini-grid">
              {days.map((d, i) => {
                if (!d) return <span key={i} className="mini-cell empty" />;
                const key = iso(d);
                const info = laborMap[key];
                const label = info?.label || (isWeekend(d) ? 'Fin de semana' : '');
                const effectiveType = info?.type || (isWeekend(d) ? 'finde' : 'laborable');
                const style = {
                  background: LABOR_TYPES[effectiveType].color,
                  color: LABOR_TYPES[effectiveType].text,
                };
                return (
                  <button
                    key={i}
                    className="mini-cell"
                    style={style}
                    title={label}
                    onClick={() => handleClick(d)}
                  >{d.getDate()}</button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
