---
Title: 'Liveness in the standard library: interface, scope decision, layout'
Ticket: IRWB-046-B
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "The interface, the unreachable-block scope decision and the layout of src/stdlib, whose first primitive is liveness."
LastUpdated: 2026-11-27
WhatFor: "The design of the standard library skeleton and the liveness primitive (IRWB-039 phase 2b)."
WhenToUse: "Before changing src/stdlib or the two liveness clients in src/typed/backend."
---

# Liveness in the standard library: interface, scope decision, layout

IRWB-039 phase 2b. The register allocator (`src/typed/backend/regalloc.ts`, `intervals`) and the copy
coalescer (`src/typed/backend/coalesce.ts`) each carry the same hand-written liveness sweep, line for
line: per-block upward-exposed uses and definitions, then backward sweeps until nothing changes. This
step moves the sweep into `src/stdlib/` and makes both clients call it.

## The interface

```ts
export interface LiveBlock {
  /** Values read before any definition of them in the block (upward-exposed uses). */
  readonly uses: ReadonlySet<number>;
  /** Values defined in the block. */
  readonly defs: ReadonlySet<number>;
  /** Indices of the successor blocks. */
  readonly succ: readonly number[];
}
export interface LiveGraph {
  /** Index 0 is the entry unless `entry` says otherwise. */
  readonly blocks: readonly LiveBlock[];
  readonly entry?: number;
}
/** Which blocks the equations run over; see "The scope decision". */
export type LivenessScope = 'all-blocks' | 'entry-reachable';
export interface Liveness { readonly in: ReadonlySet<number>[]; readonly out: ReadonlySet<number>[] }
export function liveness(graph: LiveGraph, scope: LivenessScope): Liveness;
```

- Values are numbers (virtual registers, locals). Both clients and Typed's own analyses number their
  names; if a later client needs strings, the primitive grows a generic parameter then, not now.
- The *caller* folds per-instruction uses and definitions into the per-block sets: that fold is three
  lines over the domain's `usesOf`/`defsOf`, which both clients need anyway (interval `touch`, the
  coalescer's backward walk). What was duplicated line for line — the equations and their fixpoint —
  is what the library owns.
- `uses` means *upward-exposed* uses. A caller that passes all uses instead (the obvious careless
  extraction) gets different facts; that is the "one input" of the admission rule, tested below.

The simplest alternative, taking per-instruction `(uses, defs)` points and folding inside the library,
would remove three more lines per client but grows the interface with a point concept and forces both
clients to build adapter arrays they immediately throw away; the brief fixes the interface as blocks,
successors, per-block uses and definitions, and that is what this is.

## The scope decision

A block no path from the entry reaches is where machine liveness and the framework's solver disagree.
The case (R3, probe 08): block 0 jumps to the join; block 1, which nothing reaches, also jumps to the
join; the join uses registers 64 and 65.

- `'all-blocks'` runs the equations on every block, so block 1's live-out is the join's live-in,
  `{64, 65}` — the answer both machine clients have always produced. An unreachable block is still
  laid out and still needs its registers allocated.
- `'entry-reachable'` solves only the blocks a DFS from the entry finds; the others keep the empty
  set, as the framework's solver does, so block 1's live-out is `{}`.

The two differ *only* on unreachable blocks: a reachable block's successors are reachable by
definition, so no reachable block ever joins a fact from an unreachable one. The scope is a required
parameter, so each caller states which liveness it means; a default would hide exactly the choice
this step exists to make visible. (The still simpler alternative — no parameter, always one of the
two — is rejected for the same reason: the disagreement is real, R3 found it, and the interface should
carry it.)

Both machine clients pass `'all-blocks'`: byte-identical images require it, and it is the semantics
their hand-written sweeps had. The framework's solver stays entry-reachable; a framework analysis that
wants machine facts now has a way to ask for either.

## The layout

```
src/stdlib/
  index.ts        the index: what exists, the layering rule, one line per later module
  flow/
    liveness.ts   backward gen/kill liveness over blocks (the first primitive)
```

The layering rule is the design doc's layering D: each directory uses only the directories listed
below it. `graph`, `lattice` and `num` use nothing; `ssa` and `flow` use those; `pe`, `affine` and
`term` above; `check` and `measure` on top. One line per later module, in `index.ts`:

- `graph/` — dominators and loops (later)
- `lattice/` — lattices, joins, widening (later)
- `num/` — exact small-number helpers (later)
- `flow/` — the fixpoint solver over a lattice (later; liveness lives here now)
- `ssa/` — SSA construction (later)
- `term/` — terms over a signature (later)
- `affine/` — affine forms (later)
- `pe/` — partial evaluation (later)
- `check/` — executable laws over library results (later)
- `measure/` — cost measures (later)

Only `flow/` is created now; empty directories carry no content in git, and the index is the place the
later modules are claimed.

## The clients

- `regalloc.ts` `intervals`: keep the use/def fold, replace the sweep with
  `liveness(graph, 'all-blocks')`, keep stretching intervals over `IN`/`OUT` and the exported
  `liveOut`.
- `coalesce.ts`: same call, keep the backward per-instruction walk and the interference edges.

Byte-identical argument: the primitive computes the least fixpoint of the same equations
(`in = use ∪ (out \ def)`, `out = ∪ in[succ]`, from the empty sets, monotone under union), and the
least fixpoint of a monotone system is unique, so the sweep order cannot change any block's sets. The
folds, the interval stretch and both per-instruction walks are untouched. Acceptance: the baselines
check prints `no differences`.

## Admission (R3's rule) and tests

- Named algorithm: backward gen/kill liveness. Two clients: the allocator and the coalescer.
  Executable test: `tests/stdlib/liveness.test.mjs` — exact in/out sets on a loop; the trap case under
  both scopes (all-blocks gives `{64, 65}`, entry-reachable gives `{}`); upward-exposure (a use after
  a def is not a use of the block).
- `tests/stdlib/layering.test.mjs` — fails if a module under `src/stdlib/` resolves an import outside
  `src/stdlib/`, which covers `src/framework/`, `src/typed/` and `src/tensor/` (and every other
  domain: the admission rule is that the library uses nothing outside itself).
