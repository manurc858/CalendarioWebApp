import { useState } from 'react';
import { Check, ChevronDown, Flag, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';

const statusLabels = { pending: 'Pendiente', in_progress: 'En proceso', completed: 'Completado' };

export default function TaskWidget({ todo, onChanged }) {
  const [open, setOpen] = useState(false);
  const [subtaskText, setSubtaskText] = useState('');
  const subtasks = todo.subtasks || [];
  const completed = subtasks.filter(item => !!item.done).length;
  const status = subtasks.length && completed === subtasks.length ? 'completed' : completed ? 'in_progress' : 'pending';
  const progress = subtasks.length ? Math.round((completed / subtasks.length) * 100) : 0;

  const refresh = () => onChanged?.();
  const addSubtask = async event => {
    event.preventDefault();
    if (!subtaskText.trim()) return;
    await api.addSubtask(todo.id, subtaskText.trim());
    setSubtaskText('');
    refresh();
  };

  return (
    <section className={`task-widget ${open ? 'is-open' : ''}`}>
      <button type="button" className="task-widget-head" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span className="task-widget-title">{todo.text}</span>
        <span className="task-widget-summary"><span>{progress}%</span><ChevronDown size={16} /></span>
      </button>
      <div className="task-widget-meta">
        <span className={todo.priority === 'urgent' ? 'task-priority urgent' : 'task-priority'}><Flag size={13} /> {todo.priority === 'urgent' ? 'Urgente' : 'Normal'}</span>
        <span className={`task-status ${status}`}>{statusLabels[status]}</span>
        <span className="task-widget-dates">{todo.date || 'Sin inicio'}{todo.end_date && todo.end_date !== todo.date ? ` - ${todo.end_date}` : ''}</span>
      </div>
      {open ? (
        <div className="task-widget-body">
          <div className="task-progress"><span style={{ width: `${progress}%` }} /></div>
          <div className="task-subtasks">
            {subtasks.map(subtask => (
              <div className="task-subtask" key={subtask.id}>
                <button type="button" className={`task-subtask-check ${subtask.done ? 'done' : ''}`} aria-label={subtask.done ? 'Desmarcar subtarea' : 'Completar subtarea'} onClick={async () => { await api.updateSubtask(subtask.id, { done: !subtask.done }); refresh(); }}>
                  {subtask.done ? <Check size={13} /> : null}
                </button>
                <span className={subtask.done ? 'done' : ''}>{subtask.text}</span>
                <button type="button" className="task-subtask-delete" aria-label="Eliminar subtarea" onClick={async () => { await api.deleteSubtask(subtask.id); refresh(); }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
          <form className="task-subtask-form" onSubmit={addSubtask}>
            <input value={subtaskText} onChange={event => setSubtaskText(event.target.value)} placeholder="Añadir subtarea" aria-label="Nueva subtarea" maxLength={160} />
            <button type="submit" aria-label="Añadir subtarea" disabled={!subtaskText.trim()}><Plus size={16} /></button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
