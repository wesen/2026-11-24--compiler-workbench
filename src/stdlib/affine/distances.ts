/**
 * Dependence distance vectors over affine forms (IRWB-049-A). A statement consumes a tensor under
 * one affine index per position; the distance at a position is the consumer's axis there minus the
 * read's index, so a read at the consumer's own point is aligned (distance zero), and a shifted,
 * transposed or constant index is not. `planFusion`'s join test (`joinDepth` in
 * `src/tensor/fusion.ts`) is exactly the leading positions at which every read of a group has
 * distance zero; R3 verified the two agree on 13 of 13 corpus programs.
 */
import { add, variable, type Affine } from './forms.js';

/**
 * The distance vector of a read: `axes[p] - indices[p]`, one form per position. `axes` are the
 * consumer's axis names and `indices` the read's affine indices, both covering the positions of
 * interest — a caller fusing at a depth takes the leading `depth` of each.
 */
export function distanceVector(axes: readonly string[], indices: readonly Affine[]): Affine[] {
  return axes.map((axis, p) => add(variable(axis), indices[p], -1));
}

/** Whether a form is zero (no terms, no constant): the read is aligned at that position. */
export const isZero = (a: Affine): boolean => a.constant === 0 && a.terms.length === 0;
