import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';
import FlowbiteDateInput from './FlowbiteDateInput.jsx';

/** Convert markdown → HTML for initial load into contentEditable */
function mdToHtml(md) {
  if (!md) return '';
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  const lines = html.split('\n');
  let result = [];
  let inUl = false, inOl = false;
  for (const line of lines) {
    const ulMatch = line.match(/^- (.+)/);
    const olMatch = line.match(/^\d+\. (.+)/);
    if (ulMatch) {
      if (!inUl) { result.push('<ul>'); inUl = true; }
      result.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (!inOl) { result.push('<ol>'); inOl = true; }
      result.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      if (line.startsWith('<h1>') || line.startsWith('<h2>')) {
        result.push(line);
      } else if (line.trim() === '') {
        result.push('<br>');
      } else {
        result.push(`<div>${line}</div>`);
      }
    }
  }
  if (inUl) result.push('</ul>');
  if (inOl) result.push('</ol>');
  return result.join('');
}

/** Convert HTML from contentEditable → markdown for storage */
function htmlToMd(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;

  function walk(node) {
    let md = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        md += child.textContent;
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'h1') md += `# ${walk(child)}\n`;
        else if (tag === 'h2') md += `## ${walk(child)}\n`;
        else if (tag === 'strong' || tag === 'b') md += `**${walk(child)}**`;
        else if (tag === 'em' || tag === 'i') md += `*${walk(child)}*`;
        else if (tag === 'u') md += `<u>${walk(child)}</u>`;
        else if (tag === 'a') md += `[${walk(child)}](${child.getAttribute('href') || 'url'})`;
        else if (tag === 'ul') {
          for (const li of child.querySelectorAll(':scope > li')) {
            md += `- ${walk(li)}\n`;
          }
        } else if (tag === 'ol') {
          let idx = 1;
          for (const li of child.querySelectorAll(':scope > li')) {
            md += `${idx}. ${walk(li)}\n`;
            idx++;
          }
        } else if (tag === 'li') {
          md += walk(child);
        } else if (tag === 'br') {
          md += '\n';
        } else if (tag === 'div' || tag === 'p') {
          const inner = walk(child);
          md += inner + '\n';
        } else {
          md += walk(child);
        }
      }
    }
    return md;
  }

  return walk(div).replace(/\n{3,}/g, '\n\n').trim();
}

export default function MeetingNotesEditor({ meetingType, meetingRef, meetingDate, onClose }) {
  const dialogRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const [links, setLinks] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [taskText, setTaskText] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const editorRef = useRef(null);

  useEffect(() => {
    (async () => {
      const data = await api.getMeetingNotes(meetingType, meetingRef, meetingDate);
      setLinks(data.links || '');
      setLoaded(true);
      if (editorRef.current) {
        editorRef.current.innerHTML = mdToHtml(data.notes || '');
      }
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
  }, [onClose]);

  const getMarkdown = () => {
    if (!editorRef.current) return '';
    return htmlToMd(editorRef.current.innerHTML);
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

  const exec = (cmd, value = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  const formatHeading = (tag) => {
    document.execCommand('formatBlock', false, tag);
  };

  const insertLink = () => {
    const url = prompt('URL del enlace:', 'https://');
    if (url) exec('createLink', url);
  };

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

        {/* Toolbar */}
        <div className="mn-toolbar">
          <button type="button" className="mn-tb-btn" onClick={() => formatHeading('h1')} title="Título 1">
            H1
          </button>
          <button type="button" className="mn-tb-btn" onClick={() => formatHeading('h2')} title="Título 2">
            H2
          </button>
          <button type="button" className="mn-tb-btn" onClick={() => formatHeading('div')} title="Texto normal">
            T
          </button>
          <span className="mn-tb-sep" />
          <button type="button" className="mn-tb-btn" onClick={() => exec('bold')} title="Negrita">
            <b>B</b>
          </button>
          <button type="button" className="mn-tb-btn" onClick={() => exec('italic')} title="Cursiva">
            <i>I</i>
          </button>
          <button type="button" className="mn-tb-btn" onClick={() => exec('underline')} title="Subrayado">
            <u>U</u>
          </button>
          <span className="mn-tb-sep" />
          <button type="button" className="mn-tb-btn" onClick={insertLink} title="Enlace">
            🔗
          </button>
          <button type="button" className="mn-tb-btn" onClick={() => exec('insertUnorderedList')} title="Lista con puntos">
            • Lista
          </button>
          <button type="button" className="mn-tb-btn" onClick={() => exec('insertOrderedList')} title="Lista numerada">
            1. Lista
          </button>
          <span className="mn-tb-sep" />
          <button type="button" className="mn-tb-btn" onClick={() => {
            if (!editorRef.current) return;
            const text = editorRef.current.innerText;
            navigator.clipboard.writeText(text);
          }} title="Copiar notas" aria-label="Copiar notas">
            📋
          </button>
        </div>

        {/* WYSIWYG Editor */}
        <div
          ref={editorRef}
          className="mn-wysiwyg"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Escribe las notas de la reunión…"
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
