// Markdown → Word (.docx), todo en el navegador: el documento no sale del equipo.
// La librería `docx` se carga solo al usarla para no pesar en la carga inicial.

const PAGE_W = 11906;  // A4 en twips (DXA)
const PAGE_H = 16838;
const MARGIN = 1440;   // 2,54 cm
const CONTENT_W = PAGE_W - MARGIN * 2;
const INK = '1F1B16';
const MUTED = '6B625B';
const ACCENT = '5B4BDB';
const LINE = 'D9D4CE';
const SOFT = 'F3F0EC';

// ---------- Cabecera opcional (front matter) ----------
// ---
// titulo: Seguimiento semanal
// fecha: 2026-11-14
// proyecto: Línea 3
// asistentes: Ana, Luis
// ---
const META_KEYS = {
  titulo: 'title', título: 'title', title: 'title', asunto: 'title',
  fecha: 'date', date: 'date',
  proyecto: 'project', project: 'project',
  asistentes: 'attendees', attendees: 'attendees', participantes: 'attendees',
  lugar: 'place', place: 'place',
};

export function parseFrontMatter(md) {
  const text = String(md || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = META_KEYS[kv[1].trim().toLowerCase()];
    if (key) meta[key] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body: text.slice(m[0].length) };
}

// ---------- Markdown → bloques ----------
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const splitRow = (line) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));

export function parseBlocks(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let para = [];
  let indents = [];   // pila de sangrías de la lista en curso
  let olInstance = 0; // cada lista numerada reinicia su numeración
  let olByLevel = {}; // nivel → lista numerada en curso
  let inList = false;

  const flushPara = () => {
    if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = []; }
  };
  const endList = () => { indents = []; olByLevel = {}; inList = false; };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\t/g, '    ');
    const line = raw.trimEnd();

    // bloque de código
    if (/^\s*```/.test(line)) {
      flushPara(); endList();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i++; }
      blocks.push({ type: 'code', lines: code });
      continue;
    }
    if (line.trim() === '') { flushPara(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      flushPara(); endList();
      blocks.push({ type: 'h', level: Math.min(heading[1].length, 4), text: heading[2] });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara(); endList();
      blocks.push({ type: 'hr' });
      continue;
    }
    // tabla: fila con "|" seguida de la línea separadora
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      flushPara(); endList();
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--;
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const li = raw.match(LIST_RE);
    if (li) {
      flushPara();
      const indent = li[1].length;
      if (!inList) { indents = []; }
      while (indents.length && indent < indents[indents.length - 1]) indents.pop();
      if (!indents.length || indent > indents[indents.length - 1]) indents.push(indent);
      const level = Math.min(indents.length - 1, 4);
      const ordered = /\d/.test(li[2]);
      const prev = blocks[blocks.length - 1];
      for (const k of Object.keys(olByLevel)) if (Number(k) > level) delete olByLevel[k];
      let instance = 0;
      if (ordered) {
        // continúa la numeración solo si sigue a otro elemento numerado de su mismo nivel
        const continues = inList && prev?.type === 'li' && olByLevel[level] !== undefined
          && !(prev.level === level && !prev.ordered);
        if (!continues) olByLevel[level] = ++olInstance;
        instance = olByLevel[level];
      } else {
        delete olByLevel[level];
      }
      inList = true;
      let text = li[3];
      let check = null;
      const cb = text.match(/^\[( |x|X)\]\s+(.*)$/);
      if (cb) { check = cb[1] !== ' '; text = cb[2]; }
      blocks.push({ type: 'li', level, ordered, instance, check, text });
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushPara(); endList();
      const last = blocks[blocks.length - 1];
      if (last?.type === 'quote' && lines[i - 1]?.trim() !== '') last.text += ' ' + quote[1];
      else blocks.push({ type: 'quote', text: quote[1] });
      continue;
    }
    // línea de continuación de un elemento de lista (sangrada)
    if (inList && /^\s{2,}\S/.test(raw) && blocks[blocks.length - 1]?.type === 'li') {
      blocks[blocks.length - 1].text += ' ' + line.trim();
      continue;
    }
    endList();
    para.push(line.trim());
  }
  flushPara();
  return blocks;
}

// ---------- Formato en línea ----------
const INLINE_RE = new RegExp([
  '(\\*\\*|__)(.+?)\\1',                       // 1,2  negrita
  '\\*(.+?)\\*',                               // 3    cursiva *
  '(?<![\\w])_(.+?)_(?![\\w])',                // 4    cursiva _
  '~~(.+?)~~',                                 // 5    tachado
  '`([^`]+)`',                                 // 6    código
  '<u>(.+?)</u>',                              // 7    subrayado
  '\\[([^\\]]+)\\]\\(([^)\\s]+)[^)]*\\)',      // 8,9  enlace
  '(https?://[^\\s<>)]+)',                     // 10   URL suelta
].join('|'));

function inlineRuns(docx, text, style = {}) {
  const { TextRun, ExternalHyperlink } = docx;
  const out = [];
  let rest = String(text ?? '');
  const plain = (t) => { if (t) out.push(new TextRun({ text: t, ...style })); };
  const link = (label, url) => out.push(new ExternalHyperlink({
    link: url,
    children: [new TextRun({ text: label, ...style, color: ACCENT, underline: {} })],
  }));

  while (rest) {
    const m = INLINE_RE.exec(rest);
    if (!m) { plain(rest); break; }
    plain(rest.slice(0, m.index));
    if (m[2] !== undefined) out.push(...inlineRuns(docx, m[2], { ...style, bold: true }));
    else if (m[3] !== undefined) out.push(...inlineRuns(docx, m[3], { ...style, italics: true }));
    else if (m[4] !== undefined) out.push(...inlineRuns(docx, m[4], { ...style, italics: true }));
    else if (m[5] !== undefined) out.push(...inlineRuns(docx, m[5], { ...style, strike: true }));
    else if (m[6] !== undefined) out.push(new TextRun({ text: m[6], ...style, font: 'Consolas', shading: { type: 'clear', fill: SOFT } }));
    else if (m[7] !== undefined) out.push(...inlineRuns(docx, m[7], { ...style, underline: {} }));
    else if (m[8] !== undefined) {
      if (/^(https?:|mailto:)/i.test(m[9])) link(m[8], m[9]);
      else plain(m[8]);
    } else if (m[10] !== undefined) link(m[10], m[10]);
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

// ---------- Bloques → documento Word ----------
function buildTable(docx, block) {
  const { Table, TableRow, TableCell, Paragraph, WidthType, BorderStyle, ShadingType } = docx;
  const cols = Math.max(block.header.length, ...block.rows.map(r => r.length), 1);
  const colW = Math.floor(CONTENT_W / cols);
  const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text, isHeader) => new TableCell({
    width: { size: colW, type: WidthType.DXA },
    borders,
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' } : undefined,
    children: [new Paragraph({ spacing: { after: 0 }, children: inlineRuns(docx, text || '', isHeader ? { bold: true } : {}) })],
  });
  const row = (cells, isHeader) => new TableRow({
    tableHeader: isHeader,
    children: Array.from({ length: cols }, (_, i) => cell(cells[i], isHeader)),
  });
  return new Table({
    width: { size: colW * cols, type: WidthType.DXA },
    columnWidths: Array(cols).fill(colW),
    rows: [row(block.header, true), ...block.rows.map(r => row(r, false))],
  });
}

function buildHeaderBlock(docx, meta) {
  const { Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } = docx;
  const out = [];
  if (meta.title) {
    out.push(new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: meta.title, bold: true, size: 40, color: INK })],
    }));
  }
  if (meta.kind) {
    out.push(new Paragraph({
      spacing: { after: 200 },
      children: [new TextRun({ text: meta.kind.toUpperCase(), size: 18, color: MUTED, characterSpacing: 40 })],
    }));
  }
  const rows = [
    ['Fecha', meta.date],
    ['Proyecto', meta.project],
    ['Lugar', meta.place],
    ['Asistentes', meta.attendees],
  ].filter(([, v]) => v);
  if (rows.length) {
    const labelW = 1700;
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const line = { style: BorderStyle.SINGLE, size: 4, color: LINE };
    const cell = (text, w, style) => new TableCell({
      width: { size: w, type: WidthType.DXA },
      borders: { top: none, left: none, right: none, bottom: line },
      margins: { top: 80, bottom: 80, left: 0, right: 110 },
      children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text, ...style })] })],
    });
    out.push(new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [labelW, CONTENT_W - labelW],
      rows: rows.map(([k, v]) => new TableRow({
        children: [cell(k, labelW, { bold: true, color: MUTED, size: 20 }), cell(String(v), CONTENT_W - labelW, {})],
      })),
    }));
    out.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
  }
  return out;
}

export async function markdownToDocxBlob(markdown, metaOverride = {}) {
  const docx = await import('docx');
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
    Footer, PageNumber, LevelFormat, BorderStyle, ShadingType,
  } = docx;

  const { meta: fileMeta, body } = parseFrontMatter(markdown);
  const meta = { ...fileMeta, ...Object.fromEntries(Object.entries(metaOverride).filter(([, v]) => v)) };
  const blocks = parseBlocks(body);

  // Si el documento empieza con un título H1 y no hay título en la cabecera, se usa como título.
  if (!meta.title && blocks[0]?.type === 'h' && blocks[0].level === 1) {
    meta.title = blocks.shift().text.replace(/(\*\*|__|\*|`)/g, '');
  }

  const HEADINGS = [null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  const children = buildHeaderBlock(docx, meta);

  for (const b of blocks) {
    if (b.type === 'h') {
      children.push(new Paragraph({ heading: HEADINGS[b.level], children: inlineRuns(docx, b.text) }));
    } else if (b.type === 'p') {
      children.push(new Paragraph({ children: inlineRuns(docx, b.text) }));
    } else if (b.type === 'li') {
      if (b.check !== null) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          indent: { left: 360 * (b.level + 1), hanging: 360 },
          children: [new TextRun({ text: b.check ? '☑\t' : '☐\t', font: 'Segoe UI Symbol' }), ...inlineRuns(docx, b.text)],
          tabStops: [{ type: 'left', position: 360 * (b.level + 1) }],
        }));
      } else if (b.ordered) {
        children.push(new Paragraph({
          spacing: { after: 60 },
          numbering: { reference: 'lista-numerada', level: b.level, instance: b.instance },
          children: inlineRuns(docx, b.text),
        }));
      } else {
        children.push(new Paragraph({
          spacing: { after: 60 },
          numbering: { reference: 'lista-puntos', level: b.level },
          children: inlineRuns(docx, b.text),
        }));
      }
    } else if (b.type === 'quote') {
      children.push(new Paragraph({
        indent: { left: 360 },
        border: { left: { style: BorderStyle.SINGLE, size: 18, color: LINE, space: 10 } },
        children: inlineRuns(docx, b.text, { italics: true, color: MUTED }),
      }));
    } else if (b.type === 'code') {
      b.lines.forEach((l, idx) => children.push(new Paragraph({
        spacing: { after: idx === b.lines.length - 1 ? 160 : 0 },
        shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' },
        children: [new TextRun({ text: l || ' ', font: 'Consolas', size: 19 })],
      })));
    } else if (b.type === 'hr') {
      children.push(new Paragraph({
        spacing: { before: 120, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 1 } },
        children: [],
      }));
    } else if (b.type === 'table') {
      children.push(buildTable(docx, b));
      children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    }
  }
  if (!children.length) children.push(new Paragraph({ children: [] }));

  const levels = (fmt) => Array.from({ length: 5 }, (_, level) => ({
    level,
    ...fmt(level),
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 360 } } },
  }));
  const BULLETS = ['•', '–', '•', '–', '•'];

  const doc = new Document({
    creator: 'Agenda',
    title: meta.title || 'Documento',
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: INK },
          paragraph: { spacing: { after: 140, line: 288 } },
        },
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 32, bold: true, color: INK }, paragraph: { spacing: { before: 320, after: 140 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 26, bold: true, color: ACCENT }, paragraph: { spacing: { before: 260, after: 110 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 23, bold: true, color: INK }, paragraph: { spacing: { before: 200, after: 90 }, outlineLevel: 2 } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 22, bold: true, color: MUTED }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 3 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'lista-puntos', levels: levels((l) => ({ format: LevelFormat.BULLET, text: BULLETS[l] })) },
        { reference: 'lista-numerada', levels: levels((l) => ({
          format: l % 2 === 0 ? LevelFormat.DECIMAL : LevelFormat.LOWER_LETTER,
          text: `%${l + 1}.`,
        })) },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 16, color: MUTED }),
            ],
          })],
        }),
      },
      children,
    }],
  });

  return { blob: await Packer.toBlob(doc), meta };
}

// ---------- Descarga ----------
export function slugify(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function downloadMarkdownAsDocx(markdown, { meta = {}, filename } = {}) {
  const { blob, meta: finalMeta } = await markdownToDocxBlob(markdown, meta);
  const name = filename
    || [finalMeta.kind ? slugify(finalMeta.kind) : '', finalMeta.date || '', slugify(finalMeta.title)].filter(Boolean).join('-')
    || 'documento';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/\.docx$/i, '') + '.docx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return a.download;
}

/** Lee un archivo .md elegido por el usuario */
export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
