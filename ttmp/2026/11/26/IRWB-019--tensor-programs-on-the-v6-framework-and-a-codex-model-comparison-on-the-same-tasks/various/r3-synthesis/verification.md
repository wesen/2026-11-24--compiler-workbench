---
Title: R3 synthesis, verification notes
Ticket: IRWB-019
DocType: reference
Summary: Each load-bearing claim of the four R3 framework reviews (IRWB-038-A Sol, -B Astra, -C Opus, -D Fable), the probe that tests it, and the result.
---

# R3 synthesis: verification notes

## How the probes were run

- **Code under test.** Clean `git archive` exports, built with `npx tsc -p tsconfig.json`, never the main checkout's
  working copy: it had uncommitted edits in `src/typed/analyses.ts`, `src/typed/passes.ts` and an untracked
  `src/typed/linear.ts` while this synthesis ran.
  - Probes 01–08 and 11: an export of `a0c2199`. Its `src/` is identical to `93ec5fc`, the reviewers' base
    (`git diff --stat 93ec5fc a0c2199 -- src tests` is empty).
  - Probe 09 also ran on an export of `t6-base` (`0f45d04`), the A0 cells' base.
- **Running a probe.** Every probe reads its code from `ROOT` (`scripts/00-root.mjs`). Run one as
  `ROOT=<export> node scripts/NN-*.mjs`. Its output is in `scripts/NN-*.out.txt` beside it.
- **The worktrees.** Probes 08 and 10 read the unmerged worktrees without changing them. Probe 08 bundles T6-D's
  source in memory with `write: false`; probe 10 runs only `git diff` and `git status`.
- **Status words.**
  - **Held:** the probe reproduces the claim as stated.
  - **Held, qualified:** it reproduces, but the claim's wording or its reading of the result needs a correction,
    stated in the row.
  - **Failed:** the probe contradicts the claim.
  - **Not tested:** no probe was run.

## Results

| # | Claim (who made it) | Probe | Result | Status |
|---|---|---|---|---|
| 1 | A sampled check is recorded with the same assurance as an exact one (C) | `01-assurance-of-sampled-and-exact.mjs` | A sampled differential whose generator draws only odd inputs accepts a subject that is wrong on every even input. Its record has `assurance: 'checked'`. An exhaustive check over all 256 bytes is also recorded as `assurance: 'checked'`. The constant is written at `src/framework/contracts/analysis-manager.ts:1177`. **Qualification:** the record does say how the check was made, in `evidence.method` (`sampled` or `exhaustive`). C's phrase "the record does not say so" is therefore too strong. What is true is that the `assurance` field is the same, and nothing downstream reads `evidence.method`. | Held, qualified |
| 2 | `assuranceOf` is never called (C) | same, part 4 | `assuranceOf` has no caller in `src/` or `tools/`. Its only caller is one test (`tests/framework/ext-e5.test.mjs:50`). | Held (no production caller) |
| 3 | `assuranceOf` maps missing or unknown evidence to `checked-exact` (A, B) | same, part 3 | `assuranceOf(undefined)` returns `checked-exact`, and so do `{method:'typo'}` and `{method:'exhaustive'}` (`src/framework/contracts/differential.ts:378-380`). | Held |
| 4 | Tix passes run in a strategy plan through `passAlgorithm`, and the meaning gate is silently dropped (B, C) | `02-tix-passes-in-strategy-plans.mjs` | F27's own test (`fork` and `chooseBest` over `inline` and `split-sum`) runs on the stock bridge with a bare `AnalysisManager`. Status `succeeded`; the one-statement result is chosen. A deliberately wrong pass is rejected by `applyNativePassSync` under the Tix meaning gate (`contractRejected`). Through the stock bridge the same pass `succeeded`, no contract was recorded, and y = 6 where the origin computes 4. | Held |
| 5 | BACKLOG F27: "no Tix pass can appear in a strategy plan" because the bridge needs `applyPass` and an `AnalysisManager` (coordinator) | same, part 3 | **The coordinator was wrong.** Tix passes can appear in plans today (row 4). What is lost is the meaning gate, because it is a closure passed to the sync runner (`src/tensor/index.ts:39-43`) rather than a contract. Restoring it needs no framework change: wrap `meaningGate` as an `ensures` invariant and hand it to the bridge's existing `contract` and `contractInputs` options (`src/framework/passes/bridge.ts:20-22`). F27's test then succeeds with the gate in force, and the wrong pass is rejected and falls back under `attempt`. The only adaptation was a JSON round trip of the gate's evidence, which carries an `undefined` field the manager refuses ("IR data cannot contain undefined"). | **Failed** (F27 is misstated) |
| 6 | A rejected candidate can stay visible as the store head (B) | `03-publication-before-acceptance.mjs`, part 1 | Real Tix `inline` under a contract that always rejects, with a caller-supplied `IRStore` and a fresh output id: `contractRejected`, yet `store.head('candidate')` is the rejected revision. The cause is that `openIR` retains every view it opens (`src/framework/ir/view.ts:182-190`), and `prepareNative` opens the candidate with the caller's store before the contract runs (`src/framework/passes/define-pass.ts:201-202`). **Scope:** no domain passes a store (`store.ts` has no domain importer, probe 05), so the defect is latent. | Held |
| 7 | A fact can be accepted before the enclosing pass rejects the candidate (A) | same, parts 2–3 | A pass with a contract that establishes a property and a false `preserves` claim fails with `preserveViolated`. By then the manager has recorded the execution as `accepted` and holds one fact about the rejected candidate (`probe.single-statement ok=true`). The order is the contract (`define-pass.ts:347-365`), then the preservation checks (`:367-389`). The control, `verifyTransformation(..., { deferCommit: true })`, keeps the fact private and rolls it back. | Held |
| 8 | A correspondence with complete endpoint lists and zero mapping groups is accepted (B) | `04-correspondence-content.mjs` | Accepted. **Extension:** a false group (`f/y → []`, which says that the statement that survived was deleted) is accepted too. The check validates the lists and the membership of each endpoint, not whether the mapping is true. A's P4 showed the same for CUDA kernels. | Held, extended |
| 9 | Tix `inline` is recorded as a removal (C, D) | same | On two programs the producer gets `{"from":["f/a"],"relation":"removed","to":[]}`. No entry links it to the consumer that absorbed it. | Held |
| 10 | Typed's in-place edits are `retained`: 98.5 % of 190,716 entries (C, D) | `09-edit-records-and-correspondence.mjs` | The numbers reproduce exactly on main: 190,716 entries, 187,889 `retained` with no reason (98.5 %). **Qualification on how to read them.** A Typed revision's correspondence lists every entity of the program, as F23's completeness check requires, so most of the 98.5 % are entities that did not change at all; the share is a property of the format, not a defect. The defect is narrower. Of 973 in-place edits (`replace` or `retarget` of a statement's field), 926 leave the statement's entry `retained` with no reason, and `whyEntity` skips such entries (`src/framework/ir/correspondence.ts:321`). The new value inside the statement does get an entry named after the pass. 740 entries carry a rule's note in prose (for example `!(<) is >=`). So D's "says less than the edit log" is partly wrong: the correspondence carries the rule notes, which the edit records do not, but neither carries a rule id. | Held, qualified |
| 11 | 0 edit records name a rule (D) | same | 0 on main, 0 on t6-base. | Held |
| 12 | No domain imports the rewrite, transaction or traversal modules (D) | `05-framework-reach.mjs` | **By name:** 0 imports of `ir/rewrites.ts`, `ir/transactions.ts` or `ir/traversal.ts` from `src/typed`, `src/tensor` or `src/workbench`. **Transitively,** all three are loaded, through `ir/index.ts` and `ir/view.ts:27-28`. No domain pass reads `ctx.edit` (grep), so the transaction path never runs for a domain. **Correction to D's census:** D lists `ir/diff.ts` and `ir/store.ts` beside them as "0 names imported". That is true by name, but `diff` runs on every pass application, inside `prepareNative` (`define-pass.ts:203`); it is load-bearing, not unused. | Held, qualified |
| 13 | The Tix adapter is not rewritable (D) | same | Capabilities `Traversable, Queryable, Diffable, Verifiable`; `beginEdit()` throws `ir.capability: Adapter tensor.adapter is not Rewritable`. | Held |
| 14 | The core runtime, about 1,240 lines, has no domain caller (C, D) | same | `runtime.ts` + `query.ts` + `records.ts` = 1,237 lines (1,240 counting final newlines). No domain names them and none reaches them transitively. They are imported only by `conformance/01-runtime.ts`, `labs/lab.ts`, `labs/types.ts` and the core's own files. | Held |
| 15 | The dataflow solver runs a binding-time analysis on a Tix function (C, D) | `06-binding-times-on-tix.mjs` | D's probe reproduces. A two-point lattice over a Tix function's read graph, registered as an ordinary `dataflow()` analysis and cached by the manager: with x dynamic, `scale` and `shift` are static and `norm` and `y` dynamic; making w dynamic changes the division as expected. **Qualification:** C's probe ran the solver on a hand-written def-use table, not on Tix. It shows the solver can express a cyclic division (reproduced here), but the Tix claim is D's alone. | Held (D); C's version is a toy |
| 16 | `planFusion`'s join test is a dependence-distance test (D) | `07-fusion-join-as-dependence-distance.mjs` | 13 of 13 functions agree: D's 10, plus three added here (a constant outer index, a reduction consumer, a broadcast read). **Note:** the agreement is close to definitional. `joinDepth` requires the read index at each shared position p to be exactly the consumer's axis p (`src/tensor/fusion.ts:97-103`), which is the statement that distance component p is 0. The probe confirms the reading of the code; it is not an independent discovery. | Held |
| 17 | T6-D's order validator misses a permutation that changes an f32 sum (B) | `08-t6d-order-validator.mjs` | `orderViolation` accepts the swapped strip-mined reduction. It simulates R ∈ {11, 1, 0} only, all below the factor 16 (T6-D `src/tensor/schedule.ts:312-316`). At R = 17 the order is 0,16,1,…, and the f32 sum of [2²⁴, −2²⁴, 0…, 1] is 1 in source order and 0 in the scheduled order. The pass's own precondition, `reorderPass.legal`, refuses the permutation. | Held |
| 18 | Edit-record counts: 2,021 (A0 cells, on t6-base) against 1,774 (D, on main after the D1 merge) | `09-edit-records-and-correspondence.mjs`, run on both exports with 2 and with the default number of cases | Both numbers reproduce: t6-base 2,021 edits in 199 revisions; main 1,774 in 195. The case count changes nothing on either base. **D's explanation ("checks with fewer cases") is wrong.** The 247-edit difference lies entirely in three passes: `licm` 329 → 166, `cfg` 1,058 → 990, `lvn` 44 → 28. These are exactly what D1's merged change touches: one loop per header, and LICM sharing one local among equal invariant trees (commits `dbe383f`, `6710b89`). `simplify` (140), `fold` (43), `constprop` (141), `subst` (102), `dce` (118), `bce` (26) and `strength` (20) are identical on both bases. | Held; D's reconciliation failed |
| 19 | Eight of ten T6 cells changed `src/framework`; no Typed cell did (C, D) | `10-cell-census.sh` | Eight T6 cells committed framework changes: `define-pass.ts` in six, `bridge.ts` in three, `strategy/sync.ts` in two. I and C changed nothing. The 21 D1, A0 and B1 cells changed 0 framework files, committed or uncommitted. | Held |
| 20 | Most B1 cells wrote a binding-time or specialization engine inside `src/typed` (coordinator, all four) | same | Six of seven (all but Terra low, B1-C) have new `src/typed` files with residualization or binding-time machinery: `residualize.ts`, `dispatch.ts`, `bta.ts` + `specialize-buffer.ts`, `peval.ts`, `pe.ts`, `specialize-memory.ts`. | Held |
| 21 | One runner, two drivers (D) | `11-one-runner-two-drivers.mjs` | D's prototype reproduces: the same revision from both drivers, and the synchronous driver refuses an asynchronous answer. **Qualification:** its synchronous driver answers `analysis` by calling `def.run` directly and bypasses the `AnalysisManager`, whose `analyse` is async (`analysis-manager.ts:518`). The prototype shows the runner's shape; it does not show that the manager's caching and records can be had synchronously. That is the real work of the change. | Held, qualified |
| 22 | Per-application cost of the sync runner (T6-D about 10 ms, T6-E about 30 ms, as reported) | same, last line | Stock `applyNativePassSync(inline)` on corpus `attention` with a trivial gate: 1.45 ms per application. This is a Tix module; the T6 figures were measured on schedule IRs and include their own hashing and validators. They were not rerun. | Measured (context) |
| 23 | A0's "same 183 re-derived edits under O2" (D, A0 cells) | `09`, per-pass counts | Consistent with `simplify` 140 + `fold` 43 = 183, that is, every edit of the two rule-table passes. A0-B's 203 local edits equal `simplify` + `fold` + `strength` (140 + 43 + 20). This supports C's and B's reading: the 10–20 % spread between cells comes from how the other passes (`constprop`, `subst`, `lvn`, `dce`) are binned, not from the data. | Consistent (not a proof of each cell's binning) |
| 24 | CUDA's differential needs a throwing subject runner; the runtime recovers gate kernels from source text (B) | read | `src/tensor/cuda-contract.ts:153-155` throws "CUDA checks require the batch executor"; `src/tensor/cuda-runtime.ts:142` recovers gated kernel names with a regular expression over the emitted CUDA. | Held (by reading) |

## Claims not tested here

- **A's aliased-baseline-key probe** (warm `agree`, cold `disagree`). It is synthetic by design and A labels it so; F26
  covers the case digest. Not rerun.
- **A's P7.** The Tix affine helpers lose exactness on large intermediates, and Typed and Tix `max` disagree on NaN.
  B's `08` reports the same NaN difference. Not rerun; both are marked as library requirements, not corpus failures.
- **B's liveness scope wrinkle** (an unreachable predecessor gives different live-out sets). Not rerun.
- **The cell surveys' line citations into the 31 unmerged worktrees** (C used five survey agents, D three). C and D
  each spot-checked theirs. This synthesis re-derived only the census-level facts (rows 19–20) and T6-D's validator
  (row 17).
- **T6 per-application costs** (10 ms, 30 ms) and the A0 local-share figures (10.0 %, 19.5 %) are the cells' own
  measurements.

## Corrections the coordinator should make

1. **BACKLOG F27** (`BACKLOG.md:487`) is wrong on the facts (row 5). Restate it as: "the meaning gate is a closure on
   the sync runner, so a plan drops it; express it as a contract and pass it through the bridge's `contract` and
   `contractInputs` options". The test stays the same and now passes with the gate in force (probe 02, 3a).
   Withdraw the earlier statement to the user that the async `applyPass` and the `AnalysisManager` requirement keep
   Tix out of strategies.
2. **BACKLOG F32** (`BACKLOG.md:492`) should not merge `executeSync`. The plan that motivated it runs on the existing
   interpreter (row 4). A second interpreter is no longer needed for F27.
3. **New items.** Partial publication (rows 6 and 7); `assuranceOf`'s default and the single `assurance` constant
   (rows 1–3); membership-only correspondence validation (row 8). None is in F1–F32.
4. **The 2,021 against 1,774 discrepancy** is D1's merged LICM change, not the case count (row 18). Any A0 share
   quoted against main should be recomputed on main's 1,774 edits.
