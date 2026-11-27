import { readFileSync } from 'node:fs';
const norm = s => s.replace(/\s+/g, ' ');
for (const x of 'ABCDEFGHIJKL') {
  const doc = norm(readFileSync(`docs/doc-${x}.md`, 'utf8'));
  const rev = readFileSync(`reviews/doc-${x}.md`, 'utf8');
  const quotes = [...rev.matchAll(/"([^"]{6,})"/g)].map(m => m[1]);
  for (const q of quotes) {
    const parts = q.split(/\s*…\s*/).map(p => norm(p).trim()).filter(Boolean);
    const missing = parts.filter(p => !doc.includes(p));
    if (missing.length) console.log(`doc-${x}: MISSING ${JSON.stringify(missing)}`);
  }
}
console.log('done');
