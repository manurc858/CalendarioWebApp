import { useState } from 'react';
import { fmtHours } from '../utils.js';

export default function ProjectHoursPanel({ projects, stats, onUpdateExpected }) {
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  const handleEditStart = (id, current) => {
    setEditingId(id);
    setEditValue(String(current || 0));
  };

  const handleEditSave = async (id) => {
    await onUpdateExpected(id, parseFloat(editValue) || 0);
    setEditingId(null);
  };

  return (
    <div className="project-hours-panel">
      <h3>⏰ Horas por proyecto</h3>
      <div className="hours-grid">
        {projects.map(p => {
          const stat = stats.find(s => s.id === p.id);
          const minutes = stat?.minutes || 0;
          const expectedHours = stat?.expected_hours_month || 0;
          const expectedMin = Math.round(expectedHours * 60);
          const pct = expectedMin > 0 ? Math.min(100, (minutes / expectedMin) * 100) : 0;

          return (
            <div key={p.id} className="hours-card">
              <div className="hours-header">
                <span className="project-dot" style={{ background: p.color }} />
                <div className="hours-title">{p.name}</div>
                <div className="hours-actual">{fmtHours(minutes)}</div>
              </div>
              <div className="hours-bar-row">
                <div className="hours-bar-track">
                  <div className="hours-bar-fill" style={{ width: `${pct}%`, background: p.color }} />
                </div>
              </div>
              <div className="hours-footer">
                <span className="hours-sub">
                  Esperadas: {editingId === p.id ? (
                    <input
                      type="number"
                      className="hours-input"
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      onBlur={() => handleEditSave(p.id)}
                      autoFocus
                    />
                  ) : (
                    <button className="hours-link" onClick={() => handleEditStart(p.id, expectedHours)}>
                      {fmtHours(expectedMin)}
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        {projects.length === 0 && (
          <div className="empty-state">Sin proyectos. Crea uno en la pestaña Proyectos.</div>
        )}
      </div>
    </div>
  );
}
