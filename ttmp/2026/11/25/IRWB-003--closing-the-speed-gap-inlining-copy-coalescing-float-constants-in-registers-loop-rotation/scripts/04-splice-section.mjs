// Replace the part of a Markdown file from one heading line up to (not including) another with a file's text.
//   node 04-splice-section.mjs <doc.md> "<start heading>" "<end heading>" <replacement.md>
import { readFileSync, writeFileSync } from 'node:fs';
const [doc, start, end, file] = process.argv.slice(2);
const text = readFileSync(doc, 'utf8');
const i = text.indexOf(`\n${start}\n`),
  j = text.indexOf(`\n${end}\n`);
if (i < 0 || j < 0 || j < i) throw new Error(`headings not found in order: ${i} ${j}`);
writeFileSync(doc, text.slice(0, i + 1) + readFileSync(file, 'utf8').replace(/\n*$/, '\n\n') + text.slice(j + 1));
console.log(`replaced ${j - i} characters with ${readFileSync(file, 'utf8').length}`);
