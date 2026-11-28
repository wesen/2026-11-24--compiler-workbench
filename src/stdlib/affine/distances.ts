/**
 * Dependence distances over affine forms: the second law of the `affine` module (IRWB-049-B). A
 * statement is indexed by axes `a₀ … aₙ₋₁`; a read it makes is indexed by one affine form per
 * position, `iₚ`. The distance at position p is the consumer's axis minus the read's index,
 * `aₚ - iₚ` as a form: it is zero exactly when the read touches the element the consumer computes
 * at that axis value, so "distance zero" means aligned, and a non-zero distance is how far apart the
 * producer's element and the consumer's are along that axis.
 *
 * The law a fusion decision needs is the leading positions at which every read of a statement is
 * aligned (`alignedDepth`): a group whose members share their first `d` axes can compute a statement
 * point by point over that domain exactly when, in each of those positions, every read of a member
 * has distance zero. Positions past the shorter of the axes and the read are not examined.
 */
import { add, variable, type Affine } from './forms.js';

/** The form `axis - index`: the distance at one position, zero when the read is aligned there. */
export function distance(axis: string, index: Affine): Affine {
  return add(variable(axis), index, -1);
}

/** The distance forms of a read over `axes`, one per position, up to the shorter of the two. */
export function distances(axes: readonly string[], indices: readonly Affine[]): Affine[] {
  return axes.slice(0, indices.length).map((axis, p) => distance(axis, indices[p]));
}

/** Whether a form is zero; forms built by this module carry no zero coefficient, so this is canonical. */
export function isZero(a: Affine): boolean {
  return a.constant === 0 && a.terms.length === 0;
}

/** How many leading positions of a read over `axes` have distance zero (aligned). */
export function alignedDepth(axes: readonly string[], indices: readonly Affine[]): number {
  let d = 0;
  while (d < axes.length && d < indices.length && isZero(distance(axes[d], indices[d]))) d++;
  return d;
}
