/**
 * The rule tables as text for the workbench (IRWB-006): one rule per line, with the strength of its recorded
 * evidence, at TILE_WIDTH (72) columns. A rule whose text does not fit continues on an indented line.
 */
import { TILE_WIDTH } from '../format.js';
import { RULE_EVIDENCE } from './evidence.js';
import { FOLD_RULES } from './fold.js';
import { ruleText, type RuleSet } from './form.js';
import { SIMPLIFY_RULES } from './simplify.js';
import { ruleFingerprint, type RuleEvidence, type Strength } from './verify.js';

export const RULE_SETS: Readonly<Record<string, RuleSet>> = Object.freeze({
  simplify: SIMPLIFY_RULES,
  fold: FOLD_RULES,
});

const SHORT: Record<Strength, string> = {
  proof: 'proof',
  exhaustive: 'exhaustive',
  'reduced-width+argument': 'w8+argument',
  sampled: 'sampled',
  'by-construction': 'by evaluator',
};
/** The evidence label of a rule: its strength, `stale` if the rule changed since, `none` without a record. */
export function evidenceLabel(e: RuleEvidence | undefined, fingerprint: string): string {
  if (!e) return 'none';
  if (e.fingerprint !== fingerprint) return 'stale';
  return e.verdict === 'sound' ? SHORT[e.strength!] : 'UNSOUND';
}

const wrap = (text: string, width: number, indent = ''): string[] => {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(' ')) {
    if (line && (line + ' ' + w).length > width) {
      out.push(line);
      line = indent + w;
    } else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out;
};

/** A rule set as lines of at most `width` columns: header, one line per rule, and the counts by strength. */
export function rulesListing(
  set: RuleSet,
  evidence: Readonly<Record<string, RuleEvidence>> = RULE_EVIDENCE,
  width = TILE_WIDTH,
): string {
  const nameW = Math.max(...set.rules.map(r => r.name.length)) + 1,
    labelW = 12,
    textW = width - nameW - labelW - 1;
  const lines = [
    ...wrap(`${set.name}: ${set.about}`, width),
    ...(set.property ? wrap(`(${set.property})`, width) : []),
  ];
  lines.push('');
  lines.push(
    `${'rule'.padEnd(nameW)}${'pattern → replacement'.padEnd(textW)} ${'evidence'.padStart(labelW)}`,
  );
  const counts = new Map<string, number>();
  for (const r of set.rules) {
    const label = evidenceLabel(evidence[r.name], ruleFingerprint(r));
    counts.set(label, (counts.get(label) ?? 0) + 1);
    const parts = wrap(ruleText(r), textW, '  ');
    lines.push(`${r.name.padEnd(nameW)}${parts[0].padEnd(textW)} ${label.padStart(labelW)}`);
    for (const p of parts.slice(1)) lines.push(`${' '.repeat(nameW)}${p}`);
  }
  lines.push('');
  lines.push(
    ...wrap(`${set.rules.length} rules: ${[...counts].map(([k, n]) => `${n} ${k}`).join(', ')}`, width),
  );
  return lines.join('\n');
}
