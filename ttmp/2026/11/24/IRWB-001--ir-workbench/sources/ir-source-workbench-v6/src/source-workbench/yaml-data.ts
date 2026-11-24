/**
 * A bounded YAML data reader for the workbench's own serializer output.
 * Supports block maps/sequences, JSON flow values, quoted/plain scalars and comments.
 * Deliberately excludes tags, aliases, anchors, implicit dates and block strings.
 * It never constructs classes, evaluates code or resolves external resources.
 */
export function parseYAMLData(source: string): unknown {
  if (source.length > 1_000_000) throw new Error('Plan text exceeds the 1 MB limit');
  const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
  type Line = { indent: number; text: string; number: number };
  const fail = (line: number, message: string): never => { throw new Error(`YAML line ${line}: ${message}`); };
  function withoutComment(s: string): string {
    let quote = '', escaped = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote === '"') { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quote = ''; }
      else if (quote === "'") { if (c === "'" && s[i + 1] === "'") i++; else if (c === "'") quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
    }
    return s.trimEnd();
  }
  function colon(s: string): number {
    let quote = '', escaped = false, flow = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote === '"') { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quote = ''; }
      else if (quote === "'") { if (c === "'" && s[i + 1] === "'") i++; else if (c === "'") quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '[' || c === '{') flow++;
      else if (c === ']' || c === '}') flow--;
      else if (c === ':' && flow === 0 && (i + 1 === s.length || /\s/.test(s[i + 1]))) return i;
    }
    return -1;
  }
  function checkData(value: unknown, line: number, depth = 0): void {
    if (depth > 80) fail(line, 'Data nesting exceeds 80 levels');
    if (typeof value === 'number' && !Number.isFinite(value)) fail(line, 'Numbers must be finite');
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (forbidden.has(key)) fail(line, `Reserved mapping key ${key}`);
      checkData(item, line, depth + 1);
    }
  }
  // JSON is also accepted for importing plans, but duplicate keys are checked by
  // the same scalar parser below instead of silently accepting last-write wins.
  function flow(s: string, line: number): unknown {
    let i = 0;
    const ws = () => { while (/\s/.test(s[i] ?? '') && i < s.length) i++; };
    function read(depth: number): unknown {
      if (depth > 80) fail(line, 'Data nesting exceeds 80 levels');
      ws();
      if (s[i] === '"') {
        const start = i++; let escaped = false;
        for (; i < s.length; i++) {
          if (escaped) { escaped = false; continue; }
          if (s[i] === '\\') { escaped = true; continue; }
          if (s[i] === '"') { i++; try { return JSON.parse(s.slice(start, i)); } catch { fail(line, 'Invalid double-quoted string'); } }
        }
        return fail(line, 'Unterminated string');
      }
      if (s[i] === '{') {
        i++; ws(); const out: Record<string, unknown> = {};
        if (s[i] === '}') { i++; return out; }
        while (i < s.length) {
          if (s[i] !== '"') fail(line, 'Flow mapping keys must be double-quoted');
          const key = read(depth + 1) as string;
          if (forbidden.has(key)) fail(line, `Reserved mapping key ${key}`);
          if (Object.hasOwn(out, key)) fail(line, `Duplicate mapping key ${key}`);
          ws(); if (s[i++] !== ':') fail(line, 'Expected colon in flow mapping');
          out[key] = read(depth + 1); ws();
          const c = s[i++]; if (c === '}') return out;
          if (c !== ',') fail(line, 'Expected comma or closing brace');
          ws();
        }
        return fail(line, 'Unterminated flow mapping');
      }
      if (s[i] === '[') {
        i++; ws(); const out: unknown[] = [];
        if (s[i] === ']') { i++; return out; }
        while (i < s.length) {
          out.push(read(depth + 1)); ws(); const c = s[i++];
          if (c === ']') return out;
          if (c !== ',') fail(line, 'Expected comma or closing bracket');
        }
        return fail(line, 'Unterminated flow sequence');
      }
      const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(s.slice(i));
      if (!m) return fail(line, 'Flow values use JSON syntax (quote strings)');
      i += m[0].length; const value = JSON.parse(m[0]);
      if (typeof value === 'number' && !Number.isFinite(value)) fail(line, 'Numbers must be finite');
      return value;
    }
    const value = read(0); ws();
    if (i !== s.length) fail(line, 'Unexpected text after flow value');
    return value;
  }
  function scalar(s: string, line: number): unknown {
    s = s.trim();
    if (!s) return null;
    if (/^[\[{\"]/.test(s)) return flow(s, line);
    if (s.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(s)) fail(line, 'Invalid single-quoted string');
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (/^[!&*|>]/.test(s) || s === '---' || s === '...') fail(line, 'Tags, anchors, aliases, block strings and multiple documents are unsupported');
    if (/^(null|~)$/i.test(s)) return null;
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) {
      const n = Number(s); if (!Number.isFinite(n)) fail(line, 'Numbers must be finite'); return n;
    }
    if (/^[+-]?\.(inf|nan)$/i.test(s)) fail(line, 'Numbers must be finite');
    if (colon(s) >= 0) fail(line, 'Quote strings that contain a colon followed by whitespace');
    return s;
  }
  const trimmed = source.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const value = flow(trimmed, 1); checkData(value, 1); return value;
  }
  const raw = source.split(/\r?\n/);
  if (raw.length > 25_000) throw new Error('Plan text exceeds 25,000 lines');
  const lines: Line[] = [];
  for (let index = 0; index < raw.length; index++) {
    const original = raw[index], text = withoutComment(original);
    if (!text.trim()) continue;
    if (/^\s*\t/.test(original) || /^ *\t/.test(original)) fail(index + 1, 'Use spaces for indentation');
    const indent = text.length - text.trimStart().length, body = text.trimStart();
    if (indent % 2) fail(index + 1, 'Use two-space indentation');
    if (body === '---' && lines.length === 0) continue;
    if (body === '...' && raw.slice(index + 1).every(s => !withoutComment(s).trim())) continue;
    if (body === '---' || body === '...') fail(index + 1, 'Only one YAML document is allowed');
    // Expand the ordinary "- key: value" spelling to the serializer's
    // equivalent dash-line + indented mapping without altering source numbers.
    if (body.startsWith('- ') && colon(body.slice(2)) >= 0) {
      lines.push({ indent, text: '-', number: index + 1 }, { indent: indent + 2, text: body.slice(2), number: index + 1 });
    } else lines.push({ indent, text: body, number: index + 1 });
  }
  if (!lines.length) throw new Error('Plan text is empty');
  if (lines[0].indent !== 0) fail(lines[0].number, 'The document must start at column one');
  let at = 0;
  function block(indent: number, depth: number): unknown {
    if (depth > 80) fail(lines[at].number, 'Data nesting exceeds 80 levels');
    const first = lines[at], seq = /^-(?:\s|$)/.test(first.text);
    if (!seq && colon(first.text) < 0) {
      at++; return scalar(first.text, first.number);
    }
    const result: unknown[] | Record<string, unknown> = seq ? [] : {};
    while (at < lines.length && lines[at].indent === indent) {
      const line = lines[at++];
      let key = '', rest: string;
      if (seq) {
        if (!/^-(?:\s|$)/.test(line.text)) fail(line.number, 'Cannot mix sequence items and mapping keys');
        rest = line.text.slice(1).trim();
      } else {
        const split = colon(line.text); if (split < 0) fail(line.number, 'Expected a mapping key followed by a colon');
        const keyText = line.text.slice(0, split).trim();
        const parsed = keyText.startsWith('"') || keyText.startsWith("'") ? scalar(keyText, line.number) : keyText;
        if (typeof parsed !== 'string' || !parsed) fail(line.number, 'Mapping keys must be nonempty strings');
        key = parsed as string;
        if (forbidden.has(key)) fail(line.number, `Reserved mapping key ${key}`);
        if (Object.hasOwn(result, key)) fail(line.number, `Duplicate mapping key ${key}`);
        if (!/^["']/.test(keyText) && /^[!&*\[\]{}?]/.test(key)) fail(line.number, 'Quote special characters in mapping keys');
        rest = line.text.slice(split + 1).trim();
      }
      let value: unknown;
      if (!rest && at < lines.length && lines[at].indent > indent) {
        if (lines[at].indent !== indent + 2) fail(lines[at].number, 'Nested values use two more spaces');
        value = block(indent + 2, depth + 1);
      } else {
        value = scalar(rest, line.number);
        if (at < lines.length && lines[at].indent > indent) fail(lines[at].number, 'A scalar cannot have nested content');
      }
      if (seq) (result as unknown[]).push(value); else (result as Record<string, unknown>)[key] = value;
    }
    return result;
  }
  const value = block(0, 0);
  if (at !== lines.length) fail(lines[at].number, 'Unexpected indentation or trailing content');
  checkData(value, 1);
  return value;
}
