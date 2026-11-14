// Conversión markdown ⇄ HTML para el editor de notas (contentEditable).
// Las notas se guardan siempre como markdown.

const SAFE_URL = /^(https?:|mailto:|tel:|\/|#)/i;

/** Markdown → HTML para cargar en el editor */
export function mdToHtml(md) {
  if (!md) return '';
  const html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
      const href = SAFE_URL.test(url.trim()) ? url.trim().replace(/"/g, '%22') : '#';
      return `<a href="${href}">${text}</a>`;
    });

  const lines = html.split('\n');
  const result = [];
  let inUl = false, inOl = false;
  for (const line of lines) {
    const ulMatch = line.match(/^[-*] (.+)/);
    const olMatch = line.match(/^\d+\. (.+)/);
    if (ulMatch) {
      if (inOl) { result.push('</ol>'); inOl = false; }
      if (!inUl) { result.push('<ul>'); inUl = true; }
      result.push(`<li>${ulMatch[1]}</li>`);
    } else if (olMatch) {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (!inOl) { result.push('<ol>'); inOl = true; }
      result.push(`<li>${olMatch[1]}</li>`);
    } else {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      if (/^<h[123]>/.test(line)) {
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

/** HTML del editor → markdown para guardar */
export function htmlToMd(html) {
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
        else if (tag === 'h3') md += `### ${walk(child)}\n`;
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

/** Texto plano de un markdown (para extractos y búsquedas) */
export function mdToPlain(md) {
  return String(md || '')
    .replace(/<\/?u>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|\*|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
