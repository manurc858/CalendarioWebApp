import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { cacheGet, cacheSet } from '../utils.js';
import { mdToPlain } from '../markdown.js';
import { downloadMarkdownAsDocx, readTextFile } from '../mdToDocx.js';
import RichEditor from './RichEditor.jsx';
import MeetingNotesEditor from './MeetingNotesEditor.jsx';

const fmtDate = (stamp) => {
  if (!stamp) return '';
  const d = new Date(stamp.length <= 10 ? stamp + 'T00:00:00' : stamp);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function NotesPage({ projects = [] }) {
  const [notes, setNotes] = useState(() => cacheGet('notes', []));
  const [meetingNotes, setMeetingNotes] = useState(() => cacheGet('meeting-notes', []));
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [saveState, setSaveState] = useState('idle'); // idle | pending | saving | saved | error
  const [status, setStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [meetingEditor, setMeetingEditor] = useState(null);

  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const saveTimer = useRef(null);
  const draftRef = useRef(null); // { id, title } pendiente de guardar

  const selected = useMemo(() => notes.find(n => n.id === selectedId) || null, [notes, selectedId]);
  const projectById = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects]);

  const load = useCallback(async () => {
    try {
      const [list, meetings] = await Promise.all([api.listNotes(), api.listAllMeetingNotes().catch(() => [])]);
      setNotes(list);
      setMeetingNotes(meetings);
      cacheSet('notes', list);
      cacheSet('meeting-notes', meetings);
    } catch (err) {
      console.error('Error cargando notas:', err);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const patchLocal = (id, patch) =>
    setNotes(prev => prev.map(n => (n.id === id ? { ...n, ...patch } : n)));

  // ---- Guardado automático ----
  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const draft = draftRef.current;
    if (!draft) return;
    draftRef.current = null;
    setSaveState('saving');
    try {
      const saved = await api.updateNote(draft.id, { title: draft.title, body: draft.body });
      patchLocal(draft.id, { title: saved.title, body: saved.body, updated_at: saved.updated_at });
      setSaveState(draftRef.current ? 'pending' : 'saved');
    } catch (err) {
      console.error('Error guardando la nota:', err);
      draftRef.current = draftRef.current || draft; // se reintenta con el siguiente cambio
      setSaveState('error');
    }
  }, []);

  const scheduleSave = useCallback((id, title) => {
    draftRef.current = { id, title, body: editorRef.current?.getMarkdown() ?? '' };
    setSaveState('pending');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 800);
  }, [flush]);

  // guarda lo pendiente al salir de la pantalla o cerrar la pestaña
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flush(); };
  }, [flush]);

  const select = async (id) => {
    await flush();
    setSaveState('idle');
    setSelectedId(id);
  };

  const createNote = async () => {
    await flush();
    const note = await api.createNote({ title: '', body: '' });
    setNotes(prev => [note, ...prev]);
    setSaveState('idle');
    setSelectedId(note.id);
  };

  const removeNote = async (note) => {
    if (!confirm(`¿Eliminar la nota "${note.title || 'Sin título'}"? No se puede deshacer.`)) return;
    clearTimeout(saveTimer.current);
    draftRef.current = null;
    await api.deleteNote(note.id);
    setNotes(prev => prev.filter(n => n.id !== note.id));
    setSelectedId(null);
  };

  const togglePin = async (note) => {
    const pinned = note.pinned ? 0 : 1;
    patchLocal(note.id, { pinned });
    await api.updateNote(note.id, { pinned });
    load();
  };

  const setProject = async (note, projectId) => {
    patchLocal(note.id, { project_id: projectId || null });
    await api.updateNote(note.id, { project_id: projectId || null });
  };

  // ---- Markdown → Word ----
  const flash = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(s => (s === msg ? '' : s)), 6000);
  };

  const convertFile = async (file) => {
    if (!file) return;
    if (!/\.(md|markdown|txt)$/i.test(file.name)) {
      flash('Ese archivo no es Markdown (.md).');
      return;
    }
    try {
      flash(`Convirtiendo ${file.name}…`);
      const text = await readTextFile(file);
      const name = await downloadMarkdownAsDocx(text, { filename: file.name.replace(/\.(md|markdown|txt)$/i, '') });
      flash(`Descargado: ${name}`);
    } catch (err) {
      console.error('Error convirtiendo a Word:', err);
      flash('No se ha podido convertir el archivo.');
    }
  };

  const exportNote = async (note) => {
    await flush();
    const body = editorRef.current?.getMarkdown() ?? note.body;
    try {
      const name = await downloadMarkdownAsDocx(body, {
        meta: { title: note.title || 'Nota', project: projectById[note.project_id]?.name },
      });
      flash(`Descargado: ${name}`);
    } catch (err) {
      console.error('Error exportando a Word:', err);
      flash('No se ha podido generar el documento Word.');
    }
  };

  // ---- Filtro ----
  const q = norm(query.trim());
  const visibleNotes = useMemo(() => {
    if (!q) return notes;
    return notes.filter(n =>
      norm(n.title).includes(q) || norm(n.body).includes(q) || norm(projectById[n.project_id]?.name).includes(q));
  }, [notes, q, projectById]);
  const visibleMeetingNotes = useMemo(() => {
    if (!q) return meetingNotes;
    return meetingNotes.filter(m => norm(m.title).includes(q) || norm(m.notes).includes(q));
  }, [meetingNotes, q]);

  const saveLabel = {
    pending: 'Cambios sin guardar…', saving: 'Guardando…', saved: 'Guardado', error: 'No se ha podido guardar',
  }[saveState] || '';

  return (
    <div
      className={`notes-page ${selected ? 'has-selection' : ''} ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); convertFile(e.dataTransfer.files?.[0]); }}
    >
      {/* ---- Lista ---- */}
      <div className="notes-list-pane">
        <div className="notes-list-head">
          <input
            type="search"
            className="notes-search"
            placeholder="Buscar en notas…"
            aria-label="Buscar en notas"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="notes-list-actions">
            <button type="button" className="btn btn-primary" onClick={createNote}>+ Nueva nota</button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()} title="Sube un archivo .md y descarga el Word">
              .md → Word
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              hidden
              onChange={e => { convertFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </div>
          <p className="notes-status" role="status">{status}</p>
        </div>

        <div className="notes-scroll">
          {visibleNotes.length === 0 && (
            <p className="notes-empty">
              {q ? 'Ninguna nota coincide con la búsqueda.' : 'Aún no hay notas. Crea la primera con «Nueva nota».'}
            </p>
          )}
          <ul className="notes-items">
            {visibleNotes.map(n => {
              const project = projectById[n.project_id];
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    className={`note-item ${n.id === selectedId ? 'active' : ''}`}
                    onClick={() => select(n.id)}
                    aria-current={n.id === selectedId ? 'true' : undefined}
                  >
                    <span className="note-item-title">
                      {n.pinned ? <span className="note-pin" aria-label="Fijada">★ </span> : null}
                      {n.title || 'Sin título'}
                    </span>
                    <span className="note-item-snippet">{mdToPlain(n.body).slice(0, 90) || 'Sin contenido'}</span>
                    <span className="note-item-meta">
                      {project && (
                        <span className="note-project">
                          <span className="note-project-dot" style={{ background: project.color }} />
                          {project.name}
                        </span>
                      )}
                      <span>{fmtDate(n.updated_at)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {visibleMeetingNotes.length > 0 && (
            <>
              <h2 className="notes-group-title">Notas de reunión</h2>
              <ul className="notes-items">
                {visibleMeetingNotes.map(m => (
                  <li key={`${m.meeting_type}|${m.meeting_ref}|${m.meeting_date}`}>
                    <button
                      type="button"
                      className="note-item"
                      onClick={() => setMeetingEditor(m)}
                    >
                      <span className="note-item-title">{m.title}</span>
                      <span className="note-item-snippet">{mdToPlain(m.notes).slice(0, 90)}</span>
                      <span className="note-item-meta"><span>{fmtDate(m.meeting_date)}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* ---- Editor ---- */}
      <div className="notes-editor-pane">
        {selected ? (
          <div className="note-editor" key={selected.id}>
            <div className="note-editor-head">
              <button type="button" className="btn btn-ghost note-back" onClick={() => select(null)}>‹ Notas</button>
              <span className={`note-save-state ${saveState}`} role="status">{saveLabel}</span>
              <div className="note-editor-actions">
                <button
                  type="button"
                  className={`btn btn-icon ${selected.pinned ? 'note-pinned' : ''}`}
                  onClick={() => togglePin(selected)}
                  aria-pressed={!!selected.pinned}
                  aria-label={selected.pinned ? 'Quitar de fijadas' : 'Fijar nota'}
                  title={selected.pinned ? 'Quitar de fijadas' : 'Fijar arriba'}
                >
                  {selected.pinned ? '★' : '☆'}
                </button>
                <button type="button" className="btn" onClick={() => exportNote(selected)} title="Descargar en Word">Word</button>
                <button type="button" className="btn btn-link danger" onClick={() => removeNote(selected)}>Eliminar</button>
              </div>
            </div>
            <input
              className="note-title-input"
              placeholder="Título"
              aria-label="Título de la nota"
              defaultValue={selected.title}
              onChange={e => { patchLocal(selected.id, { title: e.target.value }); scheduleSave(selected.id, e.target.value); }}
            />
            <label className="note-project-select">
              <span>Proyecto</span>
              <select
                value={selected.project_id || ''}
                onChange={e => setProject(selected, e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Sin proyecto</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <RichEditor
              ref={editorRef}
              initialMarkdown={selected.body}
              placeholder="Escribe aquí…"
              onChange={() => scheduleSave(selected.id, draftRef.current?.id === selected.id ? draftRef.current.title : selected.title)}
            />
          </div>
        ) : (
          <div className="notes-placeholder">
            <p className="notes-placeholder-title">Selecciona una nota o crea una nueva</p>
            <p>También puedes arrastrar aquí un archivo <b>.md</b> para descargarlo convertido a Word.</p>
          </div>
        )}
      </div>

      {dragOver && <div className="notes-drop-hint" aria-hidden="true">Suelta el .md para convertirlo a Word</div>}

      {meetingEditor && (
        <MeetingNotesEditor
          meetingType={meetingEditor.meeting_type}
          meetingRef={meetingEditor.meeting_ref}
          meetingDate={meetingEditor.meeting_date}
          meetingTitle={meetingEditor.title}
          onClose={() => { setMeetingEditor(null); load(); }}
        />
      )}
    </div>
  );
}
