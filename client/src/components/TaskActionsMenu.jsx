import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, Pencil, Copy, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import EditTaskModal from './EditTaskModal.jsx';

export default function TaskActionsMenu({ todo, onChanged }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [panelStyle, setPanelStyle] = useState({});
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  // Posiciona el panel junto al botón usando coordenadas de viewport
  const openMenu = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPanelStyle({
        position: 'fixed',
        top: rect.bottom + 5,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = event => {
      if (
        panelRef.current && !panelRef.current.contains(event.target) &&
        triggerRef.current && !triggerRef.current.contains(event.target)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const duplicate = async () => {
    await api.carryOverTodo(todo.id);
    setOpen(false);
    onChanged?.();
  };

  const toggleDetails = async event => {
    await api.updateTodo(todo.id, { extended: event.target.checked });
    setOpen(false);
    onChanged?.();
  };

  const remove = async () => {
    await api.deleteTodo(todo.id);
    setOpen(false);
    onChanged?.();
  };

  return (
    <div className="task-actions-menu">
      <button type="button" className="task-menu-trigger" ref={triggerRef} onClick={openMenu} aria-label="Opciones de tarea" aria-expanded={open}>
        <MoreVertical size={18} />
      </button>
      {open ? createPortal(
        <div className="task-menu-panel" role="menu" ref={panelRef} style={panelStyle}>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setEditing(true); }}><Pencil size={15} /> Editar</button>
          <button type="button" role="menuitem" onClick={duplicate}><Copy size={15} /> Duplicar al día siguiente</button>
          <label className="task-menu-switch"><span>Más información</span><input type="checkbox" checked={!!todo.extended} onChange={toggleDetails} /></label>
          <button type="button" role="menuitem" className="danger" onClick={remove}><Trash2 size={15} /> Eliminar</button>
        </div>,
        document.body
      ) : null}
      {editing ? <EditTaskModal todo={todo} onClose={() => setEditing(false)} onSaved={onChanged} /> : null}
    </div>
  );
}
