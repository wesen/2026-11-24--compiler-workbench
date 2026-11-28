/**
 * A term signature: the least a domain has to say for this directory to read its trees (IRWB-060-B, the R3 library
 * row `terms`, IRWB-039 phase 4 item 4.6).
 *
 * A term is a finite tree over an alphabet. The alphabet is the domain's: an operator label, the children in order,
 * and — for a constant — its immediate. Everything here is stated over that and nothing else. Terms are not
 * assumed to be hash-consed or interned, equal terms are not assumed to be the same object, and the signature is
 * not assumed to be fixed: a domain that allocates its nodes (Typed's transaction) or that carries attributes on
 * them (Tix's `reduce` axes) keeps those in its own code.
 *
 *   op        the root's operator. A label, and a domain may put an attribute in it (`load:f/a`,
 *             `reduce:sum`), so a pattern can name it without the library knowing what an attribute is.
 *   args      the children, in the order the domain means them (`+` is left then right, a reduction is its body).
 *   constant  the immediate of a constant term, or undefined for a term that is not one. Omitted by a signature
 *             whose alphabet has no constants.
 *
 * The theory is first-order terms (Baader–Nipkow, *Term Rewriting and All That*, ch. 2): a signature is a ranked
 * alphabet, a term is a tree over it, and a rule is a pair of terms with variables. The two functions below are the
 * part of that theory every client needs: structural equality and a structural hash, with the law that equal terms
 * hash equally. `size` is the number of nodes, for a cost measure and for a bound on a traversal.
 */
export interface Signature<T> {
  readonly op: (t: T) => string;
  readonly args: (t: T) => readonly T[];
  readonly constant?: (t: T) => number | string | undefined;
}

/** Structural equality: same operator, same immediate, same children in order, recursively. */
export function equalStructure<T>(sig: Signature<T>, a: T, b: T): boolean {
  if (a === b) return true;
  if (sig.op(a) !== sig.op(b)) return false;
  const c = sig.constant?.(a),
    d = sig.constant?.(b);
  if (c !== d) return false;
  const x = sig.args(a),
    y = sig.args(b);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) if (!equalStructure(sig, x[i], y[i])) return false;
  return true;
}

/**
 * The term's structure as one text: the operator and, if any, its immediate, then the children, each with its arity.
 * Two structural equations hold by construction (a test checks them): equal terms have equal keys, and the key is
 * the term's (a reader can rebuild the tree from it). It is the canonical form `structuralHash` digests.
 */
export function structuralKey<T>(sig: Signature<T>, t: T): string {
  const out: string[] = [];
  const walk = (x: T): void => {
    out.push(sig.op(x));
    const c = sig.constant?.(x);
    if (c !== undefined) out.push('=' + c);
    const args = sig.args(x);
    out.push('[' + args.length);
    for (const y of args) walk(y);
    out.push(']');
  };
  walk(t);
  return out.join(' ');
}

/** FNV-1a over the structural key, as 8 hexadecimal digits: a hash for a cache key, not a name. */
export function structuralHash<T>(sig: Signature<T>, t: T): string {
  const key = structuralKey(sig, t);
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The number of nodes of a term. */
export function size<T>(sig: Signature<T>, t: T): number {
  let n = 1;
  for (const a of sig.args(t)) n += size(sig, a);
  return n;
}
