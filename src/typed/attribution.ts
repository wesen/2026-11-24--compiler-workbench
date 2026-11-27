import { whyEntity } from '../framework/ir/correspondence.js';
import type { EntityCorrespondence } from '../framework/ir/types.js';
import { lowerToImage, runImage, type BackendOptionsInput } from './backend/index.js';
import type { Case } from './evaluate.js';
import type { Revision } from './program.js';

/**
 * Replay one call on a published r0..head timeline with identical lowering options.
 * Each signed delta includes the pass's indirect effects on selection, layout and allocation.
 * Per-PC counts are exclusive. A PC's (possibly multiple) provenance paths explain its
 * implementation, and must not be summed as independent charges.
 */
export function attributeInstructions(
  revisions: readonly Revision[],
  call: Pick<Case, 'fn' | 'args' | 'memory'>,
  options: BackendOptionsInput = {},
) {
  const chain: EntityCorrespondence[] = [];
  let previous = 0;
  return revisions.map(r => {
    if (r.correspondence) chain.push(r.correspondence);
    const { image, correspondence } = lowerToImage(r.artifact, options);
    const run = runImage(image, call.fn, call.args, call.memory);
    const counts = run.counts;
    if (!counts) throw new Error(`r${r.rev} ${call.fn}: instruction counters unavailable (${run.trap})`);
    const instructions = image.value.insns.flatMap(insn => {
      const executions = counts[insn.offset / 4];
      return executions ? [{ insn, executions }] : [];
    });
    const delta = r.rev === 0 ? 0 : run.steps - previous;
    previous = run.steps;
    const throughImage = [...chain, correspondence];
    return {
      rev: r.rev,
      pass: r.pass,
      steps: run.steps,
      delta,
      edits: r.edits,
      instructions,
      explain: (id: string) => whyEntity({ ...correspondence.to, entity: id }, throughImage),
    };
  });
}
