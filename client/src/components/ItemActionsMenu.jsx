import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, MoreVertical } from 'lucide-react';

// Menú de los tres puntos con el mismo aspecto que el de las tareas.
// actions: [{ label, icon, onClick, danger }] o con submenú desplegable animado:
// [{ label, icon, submenu: [{ key, label, color, active, onClick }] }]
export default function ItemActionsMenu({ actions, ariaLabel = 'Opciones' }) {
  const [open, setOpen] = useState(false);
  const [openSub, setOpenSub] = useState(null);
  const [panelStyle, setPanelStyle] = useState({});
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const toggle = event => {
    event.stopPropagation();
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelStyle({ position: 'fixed', top: rect.bottom + 5, right: window.innerWidth - rect.right });
      setOpenSub(null);
    }
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = event => {
      if (panelRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = event => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="task-actions-menu">
      <button type="button" className="task-menu-trigger" ref={triggerRef} onClick={toggle} aria-label={ariaLabel} aria-expanded={open}>
        <MoreVertical size={18} />
      </button>
      {open ? createPortal(
        <div className="task-menu-panel" role="menu" ref={panelRef} style={panelStyle} onClick={event => event.stopPropagation()}>
          {actions.map(({ label, icon: Icon, onClick, danger, submenu }) => {
            if (submenu) {
              const expanded = openSub === label;
              return (
                <div key={label} className={`item-submenu ${expanded ? 'open' : ''}`}>
                  <button
                    type="button"
                    role="menuitem"
                    aria-expanded={expanded}
                    onClick={() => setOpenSub(expanded ? null : label)}
                  >
                    {Icon ? <Icon size={15} /> : null} {label}
                    <ChevronDown size={14} className="item-submenu-caret" />
                  </button>
                  <div className="item-submenu-body" aria-hidden={!expanded}>
                    <div className="item-submenu-inner">
                      {submenu.map(opt => (
                        <button
                          key={opt.key}
                          type="button"
                          role="menuitemradio"
                          aria-checked={!!opt.active}
                          tabIndex={expanded ? 0 : -1}
                          className={`item-submenu-option ${opt.active ? 'active' : ''}`}
                          style={{ '--i': opt.index }}
                          onClick={() => { setOpen(false); opt.onClick(); }}
                        >
                          <span className="item-submenu-dot" style={opt.color ? { background: opt.color } : undefined} />
                          <span className="item-submenu-label">{opt.label}</span>
                          {opt.active ? <Check size={13} /> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={label}
                type="button"
                role="menuitem"
                className={danger ? 'danger' : undefined}
                onClick={() => { setOpen(false); onClick(); }}
              >
                {Icon ? <Icon size={15} /> : null} {label}
              </button>
            );
          })}
        </div>,
        document.body
      ) : null}
    </div>
  );
}
