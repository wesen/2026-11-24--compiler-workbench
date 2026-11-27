import type { EntityCorrespondence } from '../../framework/ir/types.js';
import type { Rv32Image } from './image.js';

/** Credit each executed word once to the latest non-retained correspondence on its covered entities.
 * A credit identifies provenance, not the counterfactual cost of a decision. */
export function attributeInstructions(
  image: Rv32Image,
  counts: Uint32Array,
  revisions: readonly { pass: string; correspondence?: EntityCorrespondence }[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const insn of image.insns) {
    const n = counts[insn.offset >>> 2] ?? 0;
    if (!n) continue;
    let ids = new Set(insn.covers);
    let credit = 'ingest/backend';
    for (let i = revisions.length - 1; i >= 0; i--) {
      const c = revisions[i].correspondence;
      if (!c) continue;
      const matches = c.entries.filter(e => e.to.some(id => ids.has(id)));
      const changed = matches.filter(e => e.relation !== 'retained');
      if (changed.length) {
        credit = `${revisions[i].pass}: ${[...new Set(changed.map(e => e.relation))].sort().join(', ')}`;
        break;
      }
      ids = new Set(matches.flatMap(e => [...e.from]));
    }
    result.set(credit, (result.get(credit) ?? 0) + n);
  }
  return result;
}
