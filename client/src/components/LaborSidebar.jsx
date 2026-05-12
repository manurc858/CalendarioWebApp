import { LABOR_TYPES, LABOR_ORDER } from '../utils.js';

export default function LaborSidebar() {
  return (
    <div className="sidebar-section">
      {/* Leyenda / selector de pincel */}
      <div className="legend">
        <div className="legend-title">Leyenda de colores</div>
        {LABOR_ORDER.map(t => (
          <div key={t} className="legend-item">
            <span className="legend-swatch" style={{ background: LABOR_TYPES[t].color, borderColor: LABOR_TYPES[t].text }} />
            <span className="legend-label">{LABOR_TYPES[t].label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
