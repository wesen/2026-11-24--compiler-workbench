#!/usr/bin/env node
// IRWB-018: crude, reproducible content metrics for design docs. Usage: node 02-content-metrics.mjs label=path ...
// Prose = lines outside frontmatter, fenced code, tables and headings. Sentences split on [.!?] followed by space.
// Categories are keyword families (a sentence can count in several); they select candidates, they do not prove intent.
import fs from 'node:fs';

const families = {
  errorContract: /\b(status|statuses|error|errors|invalid|reject|rejects|malformed|trap|traps|sentinel|unchanged|overflow|underflow|fuel|capacity|guard|guards|mismatch|-1|-2|wrong-length)\b/i,
  testing: /\b(fixture|fixtures|test|tests|case|cases|seed|seeds|oracle|vector|vectors|golden|directed|profile|profiles)\b/i,
  measurement: /\b(measure|measurement|report|median|record|heat|spill|spills|instructions per|image bytes|ratio)\b/i,
  futureFeature: /\b(future|later|once|when .{0,40}available|becomes available|router|dispatcher|FMA|constant-memory|would need|will need|pending)\b/i,
};
const noWrite = /before any (output )?(write|store|writes|stores)|no writes|leave[s]? all guest bytes alone|unchanged (guest )?memory|defined memory|before the first store/gi;
const contrast = /\b(rather than|instead of|instead,|not only|, not |whereas|unlike|as opposed to)\b/gi;

const rows = [];
for (const arg of process.argv.slice(2)) {
  const [label, file] = arg.split('=');
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  const lines = src.split('\n');
  let inCode = false, codeBlocks = 0, mermaid = 0, tables = 0, prevTable = false;
  const prose = [];
  for (const line of lines) {
    if (/^```/.test(line)) { if (!inCode) { codeBlocks++; if (/mermaid/.test(line)) mermaid++; } inCode = !inCode; continue; }
    if (inCode) continue;
    const isTable = /^\s*\|/.test(line);
    if (isTable && !prevTable) tables++;
    prevTable = isTable;
    if (isTable || /^#/.test(line) || !line.trim()) continue;
    prose.push(line.replace(/^\s*([-*]|\d+\.)\s+/, ''));
  }
  const text = prose.join(' ').replace(/\s+/g, ' ');
  const words = src.split(/\s+/).filter(Boolean).length;
  const proseWords = text.split(/\s+/).filter(Boolean).length;
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z`*\[(])/).filter(s => s.split(' ').length > 2);
  const share = {};
  for (const [k, re] of Object.entries(families)) share[k] = +(100 * sentences.filter(s => re.test(s)).length / sentences.length).toFixed(1);
  const per1k = n => +(1000 * n / Math.max(proseWords, 1)).toFixed(2);
  rows.push({
    label, words, proseWords, sentences: sentences.length,
    wordsPerSentence: +(proseWords / sentences.length).toFixed(1),
    codeBlocks, mermaid, tables,
    noWriteGuarantees: (src.match(noWrite) || []).length,
    contrastPer1k: per1k((text.match(contrast) || []).length),
    semicolonsPer1k: per1k((text.match(/;/g) || []).length),
    ...Object.fromEntries(Object.entries(share).map(([k, v]) => [k + '%', v])),
  });
}
console.log(JSON.stringify(rows, null, 1));
