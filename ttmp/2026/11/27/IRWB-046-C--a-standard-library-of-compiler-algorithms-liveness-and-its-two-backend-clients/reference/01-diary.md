# Diary — IRWB-046-C

## Entry 1 — read the ground, then wrote the design

Read the two clients and the design doc before deciding anything.

- `src/typed/backend/regalloc.ts:85` `intervals()`: per-block use/def loop (lines 87-94), then the backward
  fixpoint (lines 95-110), then the interval construction.
- `src/typed/backend/coalesce.ts:32`: the same use/def loop and the same fixpoint (lines 33-55), then the copy
  exceptions and union-find.
- Both fixpoints initialise every block to `{}` and sweep **every** block in reverse index order, with no
  reachability filter. That is the scope decision the ticket asks to make explicit.

Probe 01 (`scripts/01-unreachable-block-scopes.mjs`, after `npm run build`) on the ticket's case — block 0 jumps to
the join, block 1 (`dead`, nothing jumps to it) also jumps to the join, the join uses `r64` and `r65`:

```
machine liveness (every block):
  block 0 ["entry"] live-out {64, 65}
  block 1 ["dead"]  live-out {64, 65}
  block 2 ["join"]  live-out {}
framework solver (entry-reachable only):
  block 1 ["dead"]  in {} out {}
disagreement on block 1 live-out: {64, 65} vs {}
```

Which confirms, on this checkout rather than from the ticket text, that the two scopes disagree exactly where the
ticket says, and that both clients today answer `'all'`.

Baseline before any edit: `node .../IRWB-039/scripts/02-baselines.mjs check` prints `no differences` (5m35s).

Wrote `design-doc/01-stdlib-liveness-interface-scope-and-layout.md`: the admission case for liveness, the layout with
one line per later module, the shape/scope/result interfaces, the scope argument with probe 01's table, the clients'
edits, the tests, the alternatives, and the Later list. Decisions taken there:

- `src/stdlib/flow/liveness.ts`, with `src/stdlib/index.ts` as the only index; later modules are named in the design
  and in the index, not stubbed out as empty files.
- `LivenessScope` is required and is a discriminated union (`'all'` | `'entryReachable'` + entry), not a boolean or a
  default, so no caller gets a scope by omission.
- `reads`/`writes` return `Iterable`, so `usesOf`/`defsOf`'s arrays can be passed straight through with no per-
  instruction `Set` allocation.
- `walkBackwards(block, visit)` for per-item live sets instead of an array of sets: the coalescer walks backwards
  anyway and discards each set.
- Both clients keep the fixpoint's round-robin reverse-block order, so the extraction cannot be blamed for a change
  that is really a schedule change.
- `physicalOccupancy()`'s bitmask sweep stays; it is a third copy in a different representation and is not one of the
  two clients the step names.
