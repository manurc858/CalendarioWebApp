import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { iso } from '../utils.js';

export default function WeeklySidebar({ cursor, today, onReload }) {
  const [todoText, setTodoText] = useState('');
  const [overdue, setOverdue] = useState([]);

  const todayIso = iso(today);

  const loadOverdue = useCallback(async () => {
    try {
      const rows = await api.overdueTodos(todayIso);
      setOverdue(rows);
    } catch { setOverdue([]); }
  }, [todayIso]);

  useEffect(() => { loadOverdue(); }, [loadOverdue]);

  const addTodo = async (e) => {
    e.preventDefault();
    if (!todoText.trim()) return;
    await api.createTodo({ date: todayIso, text: todoText.trim() });
    setTodoText('');
    onReload?.();
    loadOverdue();
  };

  const handleDragStart = (e, todo) => {
    e.dataTransfer.setData('application/x-todo-id', String(todo.id));
    e.dataTransfer.setData('text/plain', todo.text);
    e.dataTransfer.effectAllowed = 'move';
  };

  const markDone = async (todoId) => {
    await api.updateTodo(todoId, { done: 1 });
    onReload?.();
    loadOverdue();
  };

  const deleteTodo = async (todoId) => {
    await api.deleteTodo(todoId);
    onReload?.();
    loadOverdue();
  };

  return (
    <div className="weekly-sidebar">
      {/* Task creator */}
      <div className="ws-create">
        <div className="ws-section-title">Crear tarea</div>
        <form className="ws-create-form" onSubmit={addTodo}>
          <input
            type="text"
            placeholder="Nueva tarea..."
            value={todoText}
            onChange={e => setTodoText(e.target.value)}
            className="inline-input"
          />
          <button type="submit" className="btn-add" disabled={!todoText.trim()}>+</button>
        </form>
        <p className="ws-hint">Arrastra las tareas a un día de la semana</p>
      </div>

      {/* Overdue tasks */}
      {overdue.length > 0 && (
        <div className="ws-overdue">
          <div className="ws-section-title ws-overdue-title">⚠️ Tareas pendientes</div>
          <ul className="ws-overdue-list">
            {overdue.map(t => (
              <li key={t.id} className="ws-overdue-item" draggable
                onDragStart={e => handleDragStart(e, t)}>
                <div className="ws-overdue-info">
                  <span className="ws-overdue-text">{t.text}</span>
                  <span className="ws-overdue-date">{t.date}</span>
                </div>
                <div className="ws-overdue-actions">
                  <button className="btn-add btn-sm" onClick={() => markDone(t.id)} title="Completar">✓</button>
                  <button className="btn-delete" onClick={() => deleteTodo(t.id)} title="Eliminar">✕</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
