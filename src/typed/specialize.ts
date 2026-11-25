/**
 * Specialization on facts from an outer artifact (design-doc 03).
 *
 * A front end above Typed (Candela, for the gallery) knows facts that Typed code cannot see: the scene index a
 * kernel instance will always be called with, the layout of a scene's packed rows. Such facts travel as a
 * `typed.bindings` artifact: for a function and one of its parameters, the value it will have, and the entity of
 * the outer artifact that says so.
 *
 * The `specialize` pass replaces each read of a bound parameter whose only reaching definition is the parameter
 * itself by the constant, and records `because: fact:<artifact>@<revision>#<entity>`. The ordinary passes then do
 * the rest (fold the comparisons, cfg the constant branches, dce the dead code), and `why` on anything they removed
 * reaches the outer fact through the because-chain.
 *
 * Specialization changes what the program means for inputs that violate the bindings, so the contract changes
 * with it: the program is checked against r0 only on cases that satisfy the bindings (`Program.assume`), and every
 * later pass is held to the same restricted contract.
 */
import { defineIR } from '../framework/contracts/definitions.js';
import type { Artifact } from '../framework/core/types.js';
import { TxError } from './tx.js';
import { typedPass } from './passes.js';

export interface Binding {
  /** The function whose parameter is bound. */
  readonly fn: string;
  /** The parameter's name. */
  readonly param: string;
  /** Its value (an enum case's value for enum parameters). */
  readonly value: number;
  /** The entity of the outer artifact that establishes the fact (e.g. `candela:scene/cornell#K.scene`). */
  readonly entity: string;
  readonly note?: string;
}
export interface Bindings {
  readonly formatVersion: 1;
  /** What produced the facts (e.g. `candela`). */
  readonly source: string;
  readonly bindings: readonly Binding[];
}

export const BindingsIR = defineIR<Bindings>({
  id: 'typed.bindings',
  version: '1',
  description:
    'parameter values a program will always be called with, and the outer entities that establish them',
  validate(value) {
    const v = value as Bindings;
    if (!v || v.formatVersion !== 1 || typeof v.source !== 'string' || !Array.isArray(v.bindings))
      throw new Error('typed.bindings: formatVersion 1, source and bindings required');
    for (const b of v.bindings)
      if (
        typeof b.fn !== 'string' ||
        typeof b.param !== 'string' ||
        !Number.isInteger(b.value) ||
        typeof b.entity !== 'string'
      )
        throw new Error(`typed.bindings: malformed binding ${JSON.stringify(b)}`);
  },
});

/** The reason a specialization cites: the outer artifact, its exact revision, and the entity. */
export const factRef = (art: Artifact<Bindings>, b: Binding) =>
  `fact:${art.kind}:${art.id}@${art.revision.slice(0, 12)}#${b.entity}`;

export const specialize = typedPass({
  name: 'specialize',
  about: 'specialization: reads of a parameter bound by an outer fact become that constant',
  needs: { reach: 'reaching' },
  writes: ['values'],
  preserves: ['cfg', 'dominators', 'loops'],
  body({ f, tx, facts, params }) {
    const art = params.bindings as Artifact<Bindings> | undefined;
    if (!art || art.kind !== BindingsIR.id)
      throw new TxError('unsupported', 'specialize needs params.bindings: a typed.bindings artifact');
    for (const b of art.value.bindings.filter(x => x.fn === f.name)) {
      const i = f.locals.findIndex(l => l.param && l.name === b.param);
      if (i < 0) throw new TxError('unknownLocal', `${f.name} has no parameter "${b.param}"`);
      for (const blk of f.blocks)
        tx.rewrite(
          v => {
            if (v.op !== 'get' || v.imm !== i || !v.statement) return;
            const defs = facts.reach!.reachingAt(v.statement, i);
            if (defs.length !== 1 || defs[0] !== `param:${i}`) return; // only the parameter's own value
            return tx.const(b.value, {
              because: [factRef(art, b)],
              note: `${b.param} = ${b.value} (${art.value.source})`,
            });
          },
          [blk],
        );
    }
  },
});
