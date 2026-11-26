/**
 * Block layout `'loops'` (IRWB-003): the order in which a function's blocks are emitted, chosen so that heavy
 * edges fall through. A greedy chain construction (Pettis and Hansen) with the static frequencies of
 * frequency.ts in place of a profile:
 *
 *   weight(b -> s) = freq(b) · prob(b -> s)
 *   for each edge by weight (ties: b's, then s's position in the IR): if b ends its chain, s starts another
 *   chain, and s is not the entry, append s's chain to b's
 *   order: the entry's chain, then the other chains by the IR position of their first block
 *
 * A back edge is never linked (its target starts the chain its source ends), so a rotated loop's latch links to
 * its exit instead, and its back edge becomes the one taken branch of an iteration. The order changes which
 * branches fall through, never what the function computes.
 */
import type { Store, WorkFn } from '../model.js';
import type { Frequencies } from './frequency.js';

export function layoutBlocks(_st: Store, f: WorkFn, fr: Frequencies): string[] {
  const ids = f.blocks.map(b => b.id);
  if (ids.length < 2) return ids;
  const pos = new Map(ids.map((b, i) => [b, i]));
  const chainOf = new Map<string, string[]>(ids.map(b => [b, [b]]));
  // equal weights (within rounding) keep the IR's own fall-through first: the estimate has no preference there
  const same = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
  const adjacent = (e: { from: string; to: string }) => (pos.get(e.to) === pos.get(e.from)! + 1 ? 0 : 1);
  const edges = fr.edges
    .filter(e => e.from !== e.to && pos.has(e.to))
    .map(e => ({ ...e, weight: fr.block.get(e.from)! * e.prob }))
    .sort(
      (a, b) =>
        (same(a.weight, b.weight) ? 0 : b.weight - a.weight) ||
        adjacent(a) - adjacent(b) ||
        pos.get(a.from)! - pos.get(b.from)! ||
        pos.get(a.to)! - pos.get(b.to)!,
    );
  for (const e of edges) {
    if (e.to === ids[0]) continue;
    const a = chainOf.get(e.from)!,
      b = chainOf.get(e.to)!;
    if (a === b || a[a.length - 1] !== e.from || b[0] !== e.to) continue;
    a.push(...b);
    for (const x of b) chainOf.set(x, a);
  }
  const chains = [...new Set(ids.map(b => chainOf.get(b)!))];
  const first = chainOf.get(ids[0])!;
  return [first, ...chains.filter(c => c !== first).sort((x, y) => pos.get(x[0])! - pos.get(y[0])!)].flat();
}
