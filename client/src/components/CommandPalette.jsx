import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { iso } from '../utils.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// "14/11", "14-11-2026", "14/11/26" → Date (o null)
function parseDate(text, today) {
  const m = text.trim().match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  let year = m[3] ? Number(m[3]) : today.getFullYear();
  if (year < 100) year += 2000;
  const d = new Date(year, month, day);
  return d.getMonth() === month && d.getDate() === day ? d : null;
}

// Paleta de comandos (Ctrl+K): navegar, saltar a una fecha, crear una tarea rápida.
export default function CommandPalette({ open, onClose, commands, today, onJumpToDate, onTaskCreated }) {
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery('');
      setActive(0);
      dialog.showModal();
      inputRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const items = useMemo(() => {
    const q = norm(query.trim());
    const list = commands.filter(c => !q || norm(`${c.label} ${c.keywords || ''}`).includes(q));
    const text = query.trim();
    if (text) {
      const date = parseDate(text, today);
      if (date) {
        list.unshift({
          id: 'jump-date',
          label: `Ir al ${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`,
          hint: 'Fecha',
          run: () => onJumpToDate(date),
        });
      }
      list.push({
        id: 'new-task-today',
        label: `Crear tarea para hoy: «${text}»`,
        hint: 'Tarea',
        run: async () => { await api.createTodo({ text, date: iso(today) }); onTaskCreated?.(); },
      });
      list.push({
        id: 'new-task-unassigned',
        label: `Crear tarea sin fecha: «${text}»`,
        hint: 'Tarea',
        run: async () => { await api.createTodo({ text, date: null }); onTaskCreated?.(); },
      });
    }
    return list;
  }, [query, commands, today, onJumpToDate, onTaskCreated]);

  useEffect(() => { setActive(0); }, [query]);

  const run = async (item) => {
    if (!item) return;
    onClose();
    try { await item.run(); } catch (err) { console.error('Error ejecutando el comando:', err); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[active]); }
  };

  return (
    <dialog
      ref={dialogRef}
      className="cmdk"
      aria-label="Paleta de comandos"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="cmdk-box">
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="Escribe un comando, una fecha (14/11) o una tarea…"
          aria-label="Comando"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdk-list"
          aria-activedescendant={items[active] ? `cmdk-${items[active].id}` : undefined}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="cmdk-list" id="cmdk-list" role="listbox">
          {items.map((item, i) => (
            <li
              key={item.id}
              id={`cmdk-${item.id}`}
              role="option"
              aria-selected={i === active}
              className={`cmdk-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(item)}
            >
              <span className="cmdk-label">{item.label}</span>
              {item.hint && <span className="cmdk-hint">{item.hint}</span>}
            </li>
          ))}
          {items.length === 0 && <li className="cmdk-empty">Sin resultados</li>}
        </ul>
        <div className="cmdk-foot">↑↓ para moverte · Intro para ejecutar · Esc para cerrar</div>
      </div>
    </dialog>
  );
}
