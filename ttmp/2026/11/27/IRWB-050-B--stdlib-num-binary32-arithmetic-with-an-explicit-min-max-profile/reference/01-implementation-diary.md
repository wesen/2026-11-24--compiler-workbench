---
Title: 'Implementation diary'
Ticket: IRWB-050-B
Status: active
Topics:
    - compiler
    - ir
    - typescript
    - verification
DocType: reference
Intent: short-term
Owners: []
RelatedFiles:
    - Path: repo://src/stdlib/num/minmax.ts
      Note: written in step 3
    - Path: repo://src/stdlib/num/binary32.ts
      Note: written in step 3, from typed/f32.ts
    - Path: repo://tests/stdlib/num.test.mjs
      Note: written in step 5
ExternalSources: []
Summary: "The chronological record of IRWB-050-B: what was run, what failed, what was decided, with the numbers."
LastUpdated: 2026-11-27
WhatFor: "Reviewing how IRWB-050-B was carried out, including the false starts and the measurement trouble."
WhenToUse: "When checking a claim in the report, or repeating the measurement."
---

# Implementation diary — IRWB-050-B (`stdlib/num`)

Branch/worktree: `v7-num-ds-x-irwb-050-b` (worktree of `2026-11-24--compiler-workbench`). All commands below were run
from the worktree root. The coordinator's ticket (`IRWB-039…`) was read only.

## Step 0 — where the two clients' rules are, and how they differ

Read `src/stdlib/index.ts` (admission rule R3, layering D, `flow/liveness.ts` as the pattern), `src/typed/f32.ts`,
`src/tensor/evaluate.ts`, `tests/stdlib/*.mjs`, and IRWB-046-B's report for the shape of the deliverable.

`grep` for the f32 surface: `typed/f32.ts` is imported by `typed/evaluate.ts`, `typed/passes.ts`,
`typed/rules/{compile,handwritten,fold,semantics}.ts`, `typed/{mutate,sccp,tx,edit-classes,listing,cases-strong}.ts`
and by `tests/typed/{f32,f32-backend,candela}.test.mjs` — all through `dist/typed/f32.js`, so the module's public
surface has to stay. Tix's min/max: `evaluate.ts`'s operation table (:19–20) and the `max` reduction (:85).
Tix evaluates at f32 *and* f64 (`contract.ts:70`, `:77`), so the library's number-level primitive must not round.

## Step 1 — ticket, then the speed probe *before* touching the code

`docmgr ticket create --ticket IRWB-050-B --title "stdlib/num: binary32 arithmetic with an explicit min/max profile"`.

Wrote `scripts/01-tix-eval-speed.mjs` (softmax 64×256 and attention 32×64×64, f32 and f64, one `runTix` per timed
sample, output hash beside the time) and ran it against the untouched build.

First failure: `createHash().update(new Float32Array(d).buffer)` — Node 24 rejects an `ArrayBuffer` argument
(`ERR_INVALID_ARG_TYPE`). Fixed with `Buffer.from(...)`.

The first numbers were useless as a baseline: 15 samples, medians 89/101/360/312 ms and minima 55/51/240/245 ms for
the same four rows, run to run — this 8-core machine had a load average near 20 and other agents' builds land in the
same minutes. Everything after this is therefore measured *interleaved* against a saved pre-change build
(`cp -r dist out/dist-before`; `out/` is gitignored) by `scripts/03-num-speed-compare.mjs`, which alternates the two
builds round by round and compares CPU time.

## Step 2 — the design decision

Options written down (design doc, "Alternatives Considered"): one unqualified `max` (the trap, rejected), two copies
of the rule (the duplication the library exists to prevent, rejected), number-only operations for Typed (loses the
NaN-payload and canonical-NaN rules, rejected), profiles named after clients (rejected: names should state the rule),
and `Math.max` as the implementation of `'minimum'` over numbers (rejected: the representation would bypass the rule
the tests are supposed to pin).

Chosen: the rule stated once, generically over a `FloatOrder<T>` representation; two profile names, `'minimumNumber'`
and `'minimum'`; Typed keeps its bit representation and its opcode tables; Tix keeps numbers.

## Step 3 — the move

- `src/stdlib/num/minmax.ts`: `MinMaxProfile`, `FloatOrder<T>`, `MinMax<T>`, `NUMBERS`, `minmax(profile, domain)`.
- `src/stdlib/num/binary32.ts`: `CANONICAL_NAN`, `fromBits`, `toBits`, `isNaNBits`, `BITS`, `round`, `toInt`,
  `Binary32Ops`, `binary32(profile)` — code moved from `typed/f32.ts`, the min/max pair now from the profile.
- `src/typed/f32.ts`: builds `F32_BINARY`/`F32_COMPARE`/`F32_UNARY` from `binary32('minimumNumber')`, re-exports the
  bit helpers, keeps `F32_RESULT`/`F32_OPERANDS`/`F32_FOLDABLE`, `f32Op` and `formatF32`.
- `src/tensor/evaluate.ts`: `const MINMAX = minmax('minimum', NUMBERS)`; `max`/`min` in the operation table and the
  `max` reduction use it; `Math.max`/`Math.min` gone.
- `src/stdlib/index.ts`: re-exports, and `num/` added to "what exists now".

`npm run check` clean, `npm run build` clean, and the baselines were still byte-identical at this point.

## Step 4 — measure the primitive

`scripts/04-minmax-cost.mjs` (20M pairs, min of 5 CPU-time rounds): `Math.max` 2.42–2.51 ns/pair, the library's
`minmax('minimum', NUMBERS).max` 13.30–13.75 ns/pair, and a hand-inlined `(x, y) => (x < y ? y : x)` 11.37–17.45
ns/pair across runs. So the profile rule is not what costs: the JavaScript call is, and `Math.max` is cheaper only
because V8 inlines its intrinsic. `scripts/05-minmax-shapes.mjs` tried a `less`-predicate interface to see if the rule
could be cheapened; the three shapes came out in noise order in different runs (plain 17.45 vs `compare` 11.25 in one
run), so the interface stayed the clearer `compare`.

## Step 5 — tests, and the trap

`tests/stdlib/num.test.mjs`, six tests. First run: 5 pass, 1 fail — my own redundant assertion
`assert.equal(BITS.compare(b(0), b(-0)) < 0, true)` (compare returns 1, so `1 < 0` is false); the line duplicated the
previous assertion and was deleted, not relaxed.

Then all five suites, the baselines, `npm run check`. All green (report has the counts).

## Step 6 — the evaluator, before against after

One measurement mistake: `rm -rf out/dist-before` while tidying (I meant to discard a bad `cp`) deleted the saved
pre-change build. Rebuilt it honestly instead of re-recording anything: `cp src/tensor/evaluate.ts out/evaluate.after.ts`,
`git checkout HEAD -- src/tensor/evaluate.ts`, `npx tsc -p tsconfig.json --outDir out/dist-before`,
`cp out/evaluate.after.ts src/tensor/evaluate.ts`, `npm run build`. Verified `grep Math.max out/dist-before/tensor/
evaluate.js` hits and `grep MINMAX dist/tensor/evaluate.js` hits before measuring. (No `git stash`: the stash stack is
shared with every other worktree.)

Two 7-round runs of `scripts/03-num-speed-compare.mjs`, CPU-time minima:

| program / precision | run A before → after | run B before → after |
| --- | --- | --- |
| softmax f32 | 13.37 → 13.95 (1.04×) | 18.38 → 20.31 (1.11×) |
| softmax f64 | 13.03 → 13.57 (1.04×) | 18.07 → 21.29 (1.18×) |
| attention f32 | 42.81 → 48.06 (1.12×) | 53.50 → 58.53 (1.09×) |
| attention f64 | 42.27 → 42.93 (1.02×) | 50.93 → 66.27 (1.30×) |

Output hashes identical in all eight rows (`5692f27afb399669`, `de29ffc9419d375a`, `6b58145b366734ed`,
`ac930cff92321f4f`), so the measurement compares the same numbers. The spread of the ratio *within* one run
(1.02–1.30 in run B) is as wide as the spread between runs; the honest statement is "no more than a few per cent,
possibly up to ~15 % on a max-reduction-heavy program, at the edge of this machine's noise".

## Step 7 — documentation and the last commit

Design doc, this diary, the report; `tasks.md`, `changelog.md`, and the ticket index's `RelatedFiles`. Last commit
holds the code, the tests, the probes and these documents.
