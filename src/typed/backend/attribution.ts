import type { CorrespondenceEntry, EntityCorrespondence, RevisionRef } from '../../framework/ir/types.js';
import type { Origin } from '../model.js';
import type { Revision } from '../program.js';
import type { Edit } from '../tx.js';
import type { Lowered } from './compile.js';
import type { ImageInsn } from './image.js';
import type { ImageRun } from './run.js';

export type AttributionRevision = Pick<Revision, 'artifact' | 'correspondence' | 'edits' | 'pass' | 'rev'>;

export interface AttributionStep {
  readonly revision: number;
  readonly pass: string;
  readonly entity: string;
  readonly entries: readonly CorrespondenceEntry[];
  readonly origin?: Origin;
  readonly edits: readonly Edit[];
  readonly changed: boolean;
}

export interface ExecutedInstruction {
  readonly instruction: ImageInsn;
  readonly count: number;
  /** Typed entities covered by this word in the image correspondence. */
  readonly covered: readonly string[];
  /** Most recent revision first. A reached entity appears once per revision. */
  readonly lineage: readonly AttributionStep[];
  readonly original: readonly string[];
}

function indexTargets(c: EntityCorrespondence): Map<string, CorrespondenceEntry[]> {
  const index = new Map<string, CorrespondenceEntry[]>();
  for (const entry of c.entries)
    for (const id of entry.to) {
      const list = index.get(id) ?? [];
      list.push(entry);
      index.set(id, list);
    }
  return index;
}

function indexEdits(edits: readonly Edit[]): Map<string, Edit[]> {
  const index = new Map<string, Edit[]>();
  for (const edit of edits) {
    // A value replacement also updates the owning statement in place. A move
    // or a retarget can keep its ID and have an implicit 'retained' edge.
    const targets = new Set([
      edit.stmt,
      edit.kind === 'replace' || edit.kind === 'replaceStmt' ? edit.to : undefined,
      edit.kind === 'block' ? edit.block : undefined,
      ...(edit.rules ?? []).map(rule => rule.to),
    ]);
    for (const id of targets) {
      if (typeof id !== 'string') continue;
      const list = index.get(id) ?? [];
      list.push(edit);
      index.set(id, list);
    }
  }
  return index;
}

function matches(ref: RevisionRef, artifact: { id: string; revision: string }): boolean {
  return ref.artifact === artifact.id && ref.revision === artifact.revision;
}

/**
 * Follow executed image words backward through an exact, published r0-to-image
 * revision chain. Works with Program.revisions or a history assembled from
 * checked pass results. The run must have counted the supplied image.
 *
 * These are associations with surviving instructions. Lower and run before and
 * after a decision to measure its net cost, including work that disappeared.
 */
export function attributeInstructions(
  lowered: Lowered,
  run: Pick<ImageRun, 'counts' | 'steps'>,
  revisions: readonly AttributionRevision[],
): ExecutedInstruction[] {
  const { image, correspondence } = lowered;
  const { counts } = run;
  if (!counts || counts.length !== image.value.bytes / 4)
    throw new Error('Instruction attribution requires per-word counts for the supplied image');
  const head = revisions.at(-1);
  if (
    !head ||
    revisions[0].artifact.value.rev !== 0 ||
    !matches(correspondence.from, head.artifact) ||
    !matches(correspondence.to, image)
  )
    throw new Error('Instruction attribution requires the image and its source revision');

  const imageTargets = indexTargets(correspondence);
  const chain = revisions
    .slice(1)
    .map((revision, i) => {
      const c = revision.correspondence;
      if (!c || !matches(c.from, revisions[i].artifact) || !matches(c.to, revision.artifact))
        throw new Error(`Missing correspondence to attribution revision r${revision.rev}`);
      return { ...revision, entries: indexTargets(c), edits: indexEdits(revision.edits) };
    })
    .reverse();

  const rows: ExecutedInstruction[] = [];
  let total = 0;
  for (const instruction of image.value.insns) {
    const count = counts[instruction.offset / 4];
    if (!count) continue;
    total += count;
    const covered = new Set(imageTargets.get(instruction.id)?.flatMap(entry => entry.from));
    const lineage: AttributionStep[] = [];
    let current = covered;
    for (const step of chain) {
      const previous = new Set<string>();
      const { values, stmts, blocks, rev } = step.artifact.value;
      for (const entity of current) {
        const entries = step.entries.get(entity) ?? [];
        for (const entry of entries) for (const parent of entry.from) previous.add(parent);
        const origin = (values[entity] ?? stmts[entity] ?? blocks[entity])?.origin.find(o => o.rev === rev);
        const edits = step.edits.get(entity) ?? [];
        const changed = !!origin || edits.length > 0 || entries.some(entry => !entry.from.includes(entity));
        lineage.push({ revision: step.rev, pass: step.pass, entity, entries, origin, edits, changed });
      }
      current = previous;
    }
    rows.push({ instruction, count, covered: [...covered], lineage, original: [...current] });
  }
  if (total !== run.steps) throw new Error('Instruction counts do not sum to the run step total');
  return rows;
}
