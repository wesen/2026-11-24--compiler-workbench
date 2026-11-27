/**
 * Scoped facts over a dominator tree.
 *
 * A fact established in a block (a name's current definition, a branch's outcome, an available expression) holds
 * in every block that block dominates. Walking the dominator tree in preorder with a table whose writes are undone
 * on the way back up gives each block exactly the facts of its dominators. This is the walk of SSA renaming (Cytron
 * et al.: a stack of names per variable) and of dominator-based value numbering and conditional propagation.
 *
 * The walk knows nothing about what a block is: the caller gives the root, the children of a node in the tree, and
 * what to do on entering a node. Every `ScopedMap` passed in `scopes` is opened before `enter(node)` and closed
 * after the node's subtree, so `enter` only writes.
 */

/** A map whose writes since the innermost `open()` are undone by `close()`. */
export class ScopedMap<K, V> {
  private readonly map = new Map<K, V>();
  private readonly log: { key: K; had: boolean; old: V | undefined }[] = [];
  private readonly marks: number[] = [];

  get(key: K): V | undefined {
    return this.map.get(key);
  }
  has(key: K): boolean {
    return this.map.has(key);
  }
  set(key: K, value: V): this {
    this.log.push({ key, had: this.map.has(key), old: this.map.get(key) });
    this.map.set(key, value);
    return this;
  }
  /** Scopes currently open. */
  get depth(): number {
    return this.marks.length;
  }
  open(): void {
    this.marks.push(this.log.length);
  }
  close(): void {
    const mark = this.marks.pop();
    if (mark === undefined) throw new Error('ScopedMap.close without open');
    while (this.log.length > mark) {
      const e = this.log.pop()!;
      if (e.had) this.map.set(e.key, e.old as V);
      else this.map.delete(e.key);
    }
  }
}

export interface Scope {
  open(): void;
  close(): void;
}

/**
 * Visit a tree in preorder without recursion. `enter(node)` runs with every scope opened for the node; the scopes
 * close when the node's subtree is done. Children are visited in the order `children` gives them.
 */
export function walkDominatorTree<N>(
  root: N,
  children: (node: N) => readonly N[],
  enter: (node: N) => void,
  scopes: readonly Scope[] = [],
): void {
  const frames: { node: N; exit: boolean }[] = [{ node: root, exit: false }];
  while (frames.length) {
    const fr = frames.pop()!;
    if (fr.exit) {
      for (let i = scopes.length - 1; i >= 0; i--) scopes[i].close();
      continue;
    }
    for (const s of scopes) s.open();
    enter(fr.node);
    frames.push({ node: fr.node, exit: true });
    const kids = children(fr.node);
    for (let i = kids.length - 1; i >= 0; i--) frames.push({ node: kids[i], exit: false });
  }
}
