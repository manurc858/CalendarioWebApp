import { useEffect, useRef, useState } from 'react';

// Selector de tipo: un círculo con el tipo activo que, al pulsarlo, se alarga
// hacia la derecha mostrando el resto de tipos (la misma forma, no un menú aparte).
export default function QuickTypeDropdown({ types, value, onChange, onSelected }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = types.find(t => t.key === value) || types[0];
  const others = types.filter(t => t.key !== current.key);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = e => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKeyDown = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const select = key => {
    onChange(key);
    setOpen(false);
    onSelected?.();
  };

  return (
    <div
      ref={rootRef}
      className={`wv-quick-type ${open ? 'open' : ''}`}
      style={{ '--n': others.length }}
      onClick={e => e.stopPropagation()}
    >
      <div className="wv-quick-pill">
        <button
          type="button"
          className="wv-quick-trigger"
          onClick={() => setOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Tipo: ${current.label}`}
          title={current.label}
        >{current.icon}</button>
        {others.map((t, i) => (
          <button
            key={t.key}
            type="button"
            className="wv-quick-option"
            style={{ '--i': i }}
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
            aria-label={t.label}
            title={t.label}
            onClick={() => select(t.key)}
          >{t.icon}</button>
        ))}
      </div>
    </div>
  );
}
