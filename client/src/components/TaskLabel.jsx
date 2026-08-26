import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Flag, Plus, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import ScheduleDate from './ScheduleDate.jsx';
import TaskActionsMenu from './TaskActionsMenu.jsx';

const statusLabels = { pending: 'Pendiente', in_progress: 'En proceso', completed: 'Completado' };

export default function TaskLabel({ todo, onChanged, compact = false }) {
  const [open, setOpen] = useState(false);
  const [subtaskText, setSubtaskText] = useState('');
  const [startDate, setStartDate] = useState(todo.date || '');
  const [endDate, setEndDate] = useState(todo.end_date || todo.date || '');
  const subtasks = todo.subtasks || [];
  const completed = subtasks.filter(subtask => !!subtask.done).length;
  const status = completed === subtasks.length && subtasks.length > 0 ? 'completed' : completed > 0 ? 'in_progress' : 'pending';
  const progress = subtasks.length ? Math.round((completed / subtasks.length) * 100) : 0;

  const dialogRef = useRef(null);
  const refresh = () => onChanged?.();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    const close = event => { if (event.target === dialog) setOpen(false); };
    const cancel = event => { event.preventDefault(); setOpen(false); };
    dialog.addEventListener('click', close);
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('click', close);
      dialog.removeEventListener('cancel', cancel);
    };
  }, [open]);
  const changePriority = async event => {
    event.stopPropagation();
    await api.updateTodo(todo.id, { priority: todo.priority === 'urgent' ? 'normal' : 'urgent' });
    refresh();
  };
  const changeDates = async range => {
    const nextStart = range.start || null;
    const nextEnd = range.end || range.start || null;
    setStartDate(range.start || '');
    setEndDate(nextEnd || '');
    await api.updateTodo(todo.id, { date: nextStart, end_date: nextEnd, extended: nextEnd !== nextStart || !!todo.extended });
    refresh();
  };
  const addSubtask = async event => {
    event.preventDefault();
    const text = subtaskText.trim();
    if (!text) return;
    await api.addSubtask(todo.id, text);
    setSubtaskText('');
    refresh();
  };

  const isExpanded = todo.extended && !compact;
  // En modo compacto el toggle abre el dialog si la tarea tiene detalles
  const canOpenDialog = todo.extended;

  return (
    <section className={`task-label ${isExpanded ? 'task-label-expanded' : ''} ${compact ? 'task-label-compact' : ''}`}>
      <div className="task-label-row">
      <button
        type="button"
        className="task-label-toggle"
        onClick={canOpenDialog ? () => setOpen(true) : undefined}
        aria-haspopup={canOpenDialog ? 'dialog' : undefined}
        style={canOpenDialog ? undefined : { cursor: 'default' }}
      >
        <span className={`task-label-name ${todo.done ? 'done' : ''}`} title={todo.text}>{todo.text}</span>
        {isExpanded ? (
          <span className="task-label-progress">
            <span className="task-label-progress-track"><span style={{ width: `${progress}%` }} /></span>
            <span className="task-label-progress-pct">{progress}%</span>
            <ChevronDown size={14} />
          </span>
        ) : null}
      </button>
      <TaskActionsMenu todo={todo} onChanged={onChanged} />
      </div>
      {isExpanded ? <div className="task-label-meta">
        <button type="button" className={`task-label-priority ${todo.priority === 'urgent' ? 'urgent' : ''}`} onClick={changePriority}><Flag size={13} /> {todo.priority === 'urgent' ? 'Urgente' : 'Normal'}</button>
        <span className={`task-label-status ${status}`}>{statusLabels[status]}</span>
        <span className="task-label-dates task-label-dates-full">{todo.date || 'Sin inicio'}{todo.end_date && todo.end_date !== todo.date ? ` - ${todo.end_date}` : ''}</span>
      </div> : null}
      {canOpenDialog ? <dialog ref={dialogRef} className="task-detail-dialog" aria-labelledby={`task-detail-title-${todo.id}`}>
        <div className="task-detail-window">
          <header className="task-detail-header">
            <div><span className="task-detail-kicker">Tarea</span><h2 id={`task-detail-title-${todo.id}`}>{todo.text}</h2></div>
            <button type="button" className="task-detail-close" onClick={() => setOpen(false)} aria-label="Cerrar ventana"><X size={18} /></button>
          </header>
          <div className="task-detail-content">
            <ScheduleDate start={startDate} end={endDate} onChange={changeDates} />
            <div className="task-detail-priority-row">
              <span>Prioridad</span>
              <button type="button" className={`task-label-priority ${todo.priority === 'urgent' ? 'urgent' : ''}`} onClick={changePriority}><Flag size={14} /> {todo.priority === 'urgent' ? 'Urgente' : 'Normal'}</button>
            </div>
            <div className="task-detail-status-row"><span>Estado</span><span className={`task-label-status ${status}`}>{statusLabels[status]}</span></div>
            <div className="task-label-details">
          <div className="task-label-bar" aria-label={`${progress}% completado`}><span style={{ width: `${progress}%` }} /></div>
          <div className="task-label-subtasks">
            {subtasks.map(subtask => (
              <div className="task-label-subtask" key={subtask.id}>
                <button type="button" className={`task-label-check ${subtask.done ? 'done' : ''}`} aria-label={subtask.done ? 'Desmarcar subtarea' : 'Completar subtarea'} onClick={async () => { await api.updateSubtask(subtask.id, { done: !subtask.done }); refresh(); }}>
                  {subtask.done ? <Check size={12} /> : null}
                </button>
                <span className={subtask.done ? 'done' : ''}>{subtask.text}</span>
                <button type="button" className="task-label-remove" aria-label="Eliminar subtarea" onClick={async () => { await api.deleteSubtask(subtask.id); refresh(); }}><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <form className="task-label-add" onSubmit={addSubtask}>
            <input value={subtaskText} onChange={event => setSubtaskText(event.target.value)} placeholder="Añadir subtarea" aria-label="Nueva subtarea" maxLength={160} />
            <button type="submit" aria-label="Añadir subtarea" disabled={!subtaskText.trim()}><Plus size={15} /></button>
          </form>
            </div>
          </div>
        </div>
      </dialog> : null}
    </section>
  );
}
