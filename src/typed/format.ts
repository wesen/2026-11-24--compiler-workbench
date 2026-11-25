/**
 * Formatting for text the workbench shows in tiles (60–80 columns wide): 72 columns by default, so files and
 * presets read without horizontal scrolling. Typed sources are left as written (all within 80 columns), because
 * their line numbers are part of provenance.
 *
 *   formatJson(value, width)  JSON that keeps an object or array on one line when it fits, and breaks it one
 *                             entry per line otherwise (prettier's rule for JSON), so plans and project files are
 *                             short and narrow.
 *   wrapProse(markdown, width) hard-wraps paragraphs and list items of Markdown at word boundaries, leaving code
 *                             fences, tables, headings, callout markers and rules alone. The workbench's renderer
 *                             joins a paragraph's lines with spaces and a list item's indented continuation lines,
 *                             so the rendered text is unchanged; a continuation line never starts with a token
 *                             that would begin another block.
 *   joinText(x)               a prose field may be a string or an array of lines (JSON strings cannot span lines);
 *                             this joins the lines with spaces.
 */

export const TILE_WIDTH = 72;

const scalar = (v: unknown) => JSON.stringify(v);

export function formatJson(value: unknown, width = TILE_WIDTH, indent = 2): string {
  // the one-line form, built structurally (string contents are never touched)
  const inlineOf = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return scalar(v);
    if (Array.isArray(v)) return `[${v.map(inlineOf).join(', ')}]`;
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return entries.length
      ? `{ ${entries.map(([k, x]) => `${scalar(k)}: ${inlineOf(x)}`).join(', ')} }`
      : '{}';
  };
  const print = (v: unknown, col: number, pad: string): string => {
    if (v === null || typeof v !== 'object') return scalar(v);
    const inline = inlineOf(v);
    // a trailing comma follows every entry but the last; leave room for it
    if (col + inline.length + 1 <= width) return inline;
    const inner = pad + ' '.repeat(indent);
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return `[\n${v.map(x => inner + print(x, inner.length, inner)).join(',\n')}\n${pad}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return '{}';
    return `{\n${entries
      .map(([k, x]) => {
        const key = `${scalar(k)}: `;
        return inner + key + print(x, inner.length + key.length, inner);
      })
      .join(',\n')}\n${pad}}`;
  };
  return print(value, 0, '') + '\n';
}

/** Split prose into lines of at most `width` columns at spaces (a word longer than the width stays whole). */
export function splitWords(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean),
    out: string[] = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

/** A line that would start another Markdown block if it began a continuation. */
const STARTS_BLOCK = /^(#|>|\||```|---|[-*+] |\d+[.)] )/;

function wrapWords(words: string[], first: string, rest: string, width: number): string[] {
  const out: string[] = [];
  let line = first,
    empty = true;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prefix = out.length ? rest : first;
    if (!empty && line.length + 1 + w.length > width) {
      // never begin a continuation line with a block marker: carry one more word on this line instead
      const tail = words.slice(i).join(' ');
      if (STARTS_BLOCK.test(tail)) {
        line += ' ' + w;
        continue;
      }
      out.push(line);
      line = rest + w;
    } else line = empty ? prefix + w : `${line} ${w}`;
    empty = false;
  }
  if (!empty) out.push(line);
  return out;
}

export function wrapProse(markdown: string, width = TILE_WIDTH): string {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0,
    fenced = false;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {
      fenced = !fenced;
      out.push(l);
      i++;
      continue;
    }
    if (fenced || l.length <= width || /^\s*$/.test(l) || /^(#|\||---|> ?\[!)/.test(l) || /^\s{4,}/.test(l)) {
      out.push(l);
      i++;
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.) (.*)$/.exec(l);
    if (li) {
      const lead = `${li[1]}${li[2]} `;
      const hang = ' '.repeat(Math.max(2, lead.length));
      out.push(...wrapWords(li[3].split(/\s+/).filter(Boolean), lead, hang, width));
    } else {
      const q = /^(> ?)(.*)$/.exec(l);
      if (q) out.push(...wrapWords(q[2].split(/\s+/).filter(Boolean), q[1], q[1], width));
      else out.push(...wrapWords(l.trim().split(/\s+/).filter(Boolean), '', '', width));
    }
    i++;
  }
  return out.join('\n');
}

export function joinText(x: unknown): string {
  return Array.isArray(x) ? x.join(' ') : String(x ?? '');
}
