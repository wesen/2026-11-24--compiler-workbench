/**
 * Dependence direction vectors, and the legality of loop reordering, strip-mining and parallel
 * execution over them (IRWB-057; Allen and Kennedy, "Optimizing Compilers for Modern
 * Architectures", sections 2.2, 5.2 and 9.3; Wolfe's direction vectors).
 *
 * A dependence runs from a source iteration to a sink iteration that must execute after it. Its
 * direction at a loop compares the two iterations' values of that loop's index: `<` the source's is
 * smaller (the distance, sink minus source, is positive), `=` equal, `>` larger, `*` unknown.
 *
 *   - A loop order is legal when every direction vector, read in that order, is lexicographically
 *     non-negative: all `=`, or its first other component is `<`. Then the loops still run the
 *     source first.
 *   - Strip-mining a loop of index k into an outer index q and an inner index j, k = T q + j with
 *     0 <= j < T, is a bijection for every block size T >= 1 and every extent (quotient and
 *     remainder are unique), so it is always legal; it replaces the loop's direction by the
 *     directions of (q, j). For k < k' (`<`): q <= q', and q = q' forces j < j', so the pairs are
 *     (`=`, `<`) and (`<`, `*`). Reordering to (j, q) then reads (`*`, `<`), which is not
 *     non-negative: that is the reordered strip-mined reduction, wrong as soon as the extent
 *     exceeds T.
 *   - A loop may run its iterations concurrently when every vector has `=` at it (no dependence
 *     between two of its iterations).
 *
 * The statements hold for every extent and block size, so a check over these vectors needs no
 * sample extents.
 */
import type { Affine } from './forms.js';

export type Direction = '<' | '=' | '>' | '*';

/** The direction of a distance (sink minus source): its sign when it is a constant, `*` when symbolic. */
export function direction(distance: Affine): Direction {
  if (distance.terms.length) return '*';
  return distance.constant > 0 ? '<' : distance.constant < 0 ? '>' : '=';
}

const mined: Record<Direction, [Direction, Direction][]> = {
  '=': [['=', '=']],
  '<': [
    ['=', '<'],
    ['<', '*'],
  ],
  '>': [
    ['=', '>'],
    ['>', '*'],
  ],
  '*': [['*', '*']],
};
/** The vectors after strip-mining the loop at `position` into an outer loop there and an inner loop after it. */
export function stripMine(vectors: readonly (readonly Direction[])[], position: number): Direction[][] {
  return vectors.flatMap(v =>
    mined[v[position]].map(pair => [...v.slice(0, position), ...pair, ...v.slice(position + 1)]),
  );
}

export interface ScheduledLoop {
  /** The loop's position in the direction vectors. */
  readonly position: number;
  /** Whether its iterations run concurrently. */
  readonly parallel: boolean;
}
export interface OrderViolation {
  readonly vector: readonly Direction[];
  /** The position (in the vector) of the loop at which the order fails. */
  readonly position: number;
  readonly kind: 'parallel' | 'reversed';
}
/**
 * The first dependence that a loop nest does not respect, or undefined when it respects all of them. `nest` lists
 * every loop once, outermost first. A dependence between two iterations of a parallel loop is a violation
 * (`parallel`); otherwise the serial loops, in nest order, must run the source first (`reversed` when the first
 * component that is not `=` is `>` or `*`).
 */
export function orderViolation(
  vectors: readonly (readonly Direction[])[],
  nest: readonly ScheduledLoop[],
): OrderViolation | undefined {
  for (const vector of vectors) {
    const concurrent = nest.find(l => l.parallel && vector[l.position] !== '=');
    if (concurrent) return { vector, position: concurrent.position, kind: 'parallel' };
    const first = nest.find(l => vector[l.position] !== '=');
    if (first && vector[first.position] !== '<')
      return { vector, position: first.position, kind: 'reversed' };
  }
  return undefined;
}
