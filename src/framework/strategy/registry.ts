import type { AlgorithmKind, AlgorithmRef, StrategyAlgorithm } from './ir.js';

/** Exact version resolution; registration cannot silently replace an implementation. */
export class AlgorithmRegistry {
  private readonly algorithms = new Map<string, StrategyAlgorithm>();
  register(algorithm: StrategyAlgorithm): this {
    if (
      !algorithm ||
      typeof algorithm.id !== 'string' ||
      !algorithm.id.trim() ||
      typeof algorithm.version !== 'string' ||
      !algorithm.version.trim() ||
      typeof algorithm.description !== 'string' ||
      typeof algorithm.run !== 'function'
    )
      throw new Error('An algorithm needs text id, version, description and a run function');
    if (!['transform', 'analysis', 'predicate', 'selector', 'invariant', 'metrics'].includes(algorithm.kind))
      throw new Error(`Invalid algorithm kind ${algorithm.kind}`);
    const key = this.key(algorithm);
    if (this.algorithms.has(key))
      throw new Error(`Algorithm ${algorithm.id}@${algorithm.version} is already registered`);
    this.algorithms.set(key, Object.freeze({ ...algorithm }));
    return this;
  }
  get(ref: AlgorithmRef, kind?: AlgorithmKind): StrategyAlgorithm {
    const found = this.algorithms.get(this.key(ref));
    if (!found) throw new Error(`Algorithm ${ref.id}@${ref.version} is not registered`);
    if (kind && found.kind !== kind)
      throw new Error(`Algorithm ${ref.id}@${ref.version} is ${found.kind}, expected ${kind}`);
    return found;
  }
  has(ref: AlgorithmRef, kind?: AlgorithmKind): boolean {
    try {
      this.get(ref, kind);
      return true;
    } catch {
      return false;
    }
  }
  list() {
    return [...this.algorithms.values()]
      .map(({ id, version, kind, description }) => ({ id, version, kind, description }))
      .sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0,
      );
  }
  snapshot(): AlgorithmRegistry {
    const copy = new AlgorithmRegistry();
    for (const algorithm of this.algorithms.values()) copy.register(algorithm);
    return copy;
  }
  private key(ref: AlgorithmRef) {
    return JSON.stringify([ref.id, ref.version]);
  }
}
