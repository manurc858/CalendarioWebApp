import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';
import FlowbiteDateInput from './FlowbiteDateInput.jsx';
import RichEditor from './RichEditor.jsx';
import { downloadMarkdownAsDocx, readTextFile } from '../mdToDocx.js';

export default function MeetingNotesEditor({ meetingType, meetingRef, meetingDate, meetingTitle = '', projectName = '', onClose }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const [links, setLinks] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [initialNotes, setInitialNotes] = useState('');
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef(null);
  const [taskText, setTaskText] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const editorRef = useRef(null);

  useEffect(() => {
    (async () => {
      const data = await api.getMeetingNotes(meetingType, meetingRef, meetingDate);
      setLinks(data.links || '');
      setInitialNotes(data.notes || '');
      setLoaded(true);
    })();
  }, [meetingType, meetingRef, meetingDate]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    restoreFocusRef.current = document.activeElement;
    if (!dialog.open) dialog.showModal();

    const onCancel = (e) => {
      e.preventDefault();
      onClose();
    };

    const onBackdropClick = (e) => {
      if (e.target === dialog) onClose();
    };

    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('click', onBackdropClick);

    return () => {
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('click', onBackdropClick);
      if (dialog.open) dialog.close();
      const toFocus = restoreFocusRef.current;
      if (toFocus && typeof toFocus.focus === 'function' && document.contains(toFocus)) {
        requestAnimationFrame(() => toFocus.focus());
      }
    };
  }, [onClose, loaded]);

  const getMarkdown = () => editorRef.current?.getMarkdown() || '';

  // Acta en Word a partir de las notas (se genera en el navegador)
  const exportWord = async () => {
    setExporting(true);
    try {
      await downloadMarkdownAsDocx(getMarkdown(), {
        meta: { kind: 'Acta de reunión', title: meetingTitle || 'Reunión', date: meetingDate, project: projectName },
      });
    } catch (err) {
      console.error('Error exportando a Word:', err);
      alert('No se ha podido generar el documento Word.');
    }
    setExporting(false);
  };

  const importMarkdown = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const text = await readTextFile(file);
    const current = getMarkdown();
    if (current.trim() && !confirm('¿Sustituir las notas actuales por el contenido del archivo?')) return;
    editorRef.current?.setMarkdown(text);
  };

  const save = useCallback(async () => {
    setSaving(true);
    const notes = getMarkdown();
    await api.saveMeetingNotes({
      meeting_type: meetingType,
      meeting_ref: meetingRef,
      meeting_date: meetingDate,
      notes,
      links,
    });
    setSaving(false);
  }, [meetingType, meetingRef, meetingDate, links]);

  const addTask = async (e) => {
    e.preventDefault();
    if (!taskText.trim()) return;
    await api.createTodo({ text: taskText.trim(), date: taskDate || null });
    setTaskText('');
    setTaskDate('');
  };

  if (!loaded) return <div className="mn-editor-loading">Cargando notas…</div>;

  return (
    <dialog ref={dialogRef} className="mn-editor-dialog" aria-labelledby="meeting-notes-dialog-title">
      <div className="mn-editor">
        <div className="mn-editor-head">
          <h3 id="meeting-notes-dialog-title">📝 Notas de reunión</h3>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Cerrar editor de notas">✕</button>
        </div>

        <RichEditor
          ref={editorRef}
          initialMarkdown={initialNotes}
          placeholder="Escribe las notas de la reunión…"
          ariaLabel="Notas de la reunión"
          toolbarExtra={
            <>
              <span className="mn-tb-sep" />
              <button type="button" className="mn-tb-btn" onClick={() => fileRef.current?.click()} title="Cargar un archivo Markdown en las notas">
                Importar .md
              </button>
              <button type="button" className="mn-tb-btn mn-tb-word" onClick={exportWord} disabled={exporting} title="Descargar el acta en Word">
                {exporting ? 'Generando…' : 'Acta en Word'}
              </button>
              <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={importMarkdown} />
            </>
          }
        />

        {/* Links section */}
        <div className="mn-links-section">
          <label className="mn-links-label">🔗 Links de interés (uno por línea)</label>
          <textarea
            className="mn-links-textarea"
            value={links}
            onChange={e => setLinks(e.target.value)}
            placeholder="https://ejemplo.com&#10;https://docs.google.com/..."
            rows={2}
          />
          {links && (
            <div className="mn-links-list">
              {links.split('\n').filter(l => l.trim()).map((link, i) => (
                <a key={i} href={link.trim()} target="_blank" rel="noopener noreferrer" className="mn-link-item">
                  {link.trim()}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* Task creation */}
        <div className="mn-task-section">
          <label className="mn-links-label">✅ Crear tarea desde reunión</label>
          <form className="mn-task-form" onSubmit={addTask}>
            <input
              type="text"
              className="inline-input mn-task-input"
              placeholder="Nueva tarea…"
              value={taskText}
              onChange={e => setTaskText(e.target.value)}
            />
            <FlowbiteDateInput
              value={taskDate}
              onValueChange={setTaskDate}
              className="inline-input mn-task-date"
              title="Fecha (vacío = sin asignar)"
              placeholder="Sin fecha"
            />
            <button type="submit" className="btn-add" disabled={!taskText.trim()}>+</button>
          </form>
          <p className="mn-task-hint">Sin fecha → aparece en tareas sin asignar de la vista semanal</p>
        </div>

        {/* Actions */}
        <div className="mn-editor-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={async () => { await save(); onClose(); }} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
