import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { mdToHtml, htmlToMd } from '../markdown.js';

// Editor de texto enriquecido (barra + contentEditable) que lee y devuelve markdown.
// El contenido inicial se carga al montar: para cambiar de documento, vuelve a
// montarlo con otra `key`.
const RichEditor = forwardRef(function RichEditor(
  { initialMarkdown = '', placeholder = '', onChange, toolbarExtra = null, ariaLabel = 'Texto de la nota' },
  ref
) {
  const elRef = useRef(null);

  useEffect(() => {
    if (elRef.current) elRef.current.innerHTML = mdToHtml(initialMarkdown);
    // solo al montar (ver comentario de cabecera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    getMarkdown: () => htmlToMd(elRef.current?.innerHTML || ''),
    getText: () => elRef.current?.innerText || '',
    setMarkdown: (md) => {
      if (elRef.current) elRef.current.innerHTML = mdToHtml(md || '');
      onChange?.();
    },
    focus: () => elRef.current?.focus(),
  }));

  const exec = (cmd, value = null) => {
    elRef.current?.focus();
    document.execCommand(cmd, false, value);
    onChange?.();
  };
  const insertLink = () => {
    const url = prompt('URL del enlace:', 'https://');
    if (url) exec('createLink', url);
  };

  return (
    <>
      <div className="mn-toolbar" role="toolbar" aria-label="Formato">
        <button type="button" className="mn-tb-btn" onClick={() => exec('formatBlock', 'h1')} title="Título 1">H1</button>
        <button type="button" className="mn-tb-btn" onClick={() => exec('formatBlock', 'h2')} title="Título 2">H2</button>
        <button type="button" className="mn-tb-btn" onClick={() => exec('formatBlock', 'div')} title="Texto normal">T</button>
        <span className="mn-tb-sep" />
        <button type="button" className="mn-tb-btn" onClick={() => exec('bold')} title="Negrita"><b>B</b></button>
        <button type="button" className="mn-tb-btn" onClick={() => exec('italic')} title="Cursiva"><i>I</i></button>
        <button type="button" className="mn-tb-btn" onClick={() => exec('underline')} title="Subrayado"><u>U</u></button>
        <span className="mn-tb-sep" />
        <button type="button" className="mn-tb-btn" onClick={insertLink} title="Enlace" aria-label="Insertar enlace">🔗</button>
        <button type="button" className="mn-tb-btn" onClick={() => exec('insertUnorderedList')} title="Lista con puntos">• Lista</button>
        <button type="button" className="mn-tb-btn" onClick={() => exec('insertOrderedList')} title="Lista numerada">1. Lista</button>
        <span className="mn-tb-sep" />
        <button
          type="button"
          className="mn-tb-btn"
          onClick={() => navigator.clipboard?.writeText(elRef.current?.innerText || '')}
          title="Copiar texto"
          aria-label="Copiar texto"
        >
          📋
        </button>
        {toolbarExtra}
      </div>
      <div
        ref={elRef}
        className="mn-wysiwyg"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        onInput={() => onChange?.()}
      />
    </>
  );
});

export default RichEditor;
