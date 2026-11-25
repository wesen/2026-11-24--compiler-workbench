# Changelog

## 2026-11-24

- Initial workspace created

## 2026-11-24

Imported IR Workbench v6 archive + user guide into sources/local; verified archive against WORKSPACE-MANIFEST.json (971/971 match); wrote analysis/01 and diary. Re-running shipped tests was blocked by session permissions and is left as a task.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/analysis/01-ir-workbench-v6-import-analysis.md — Analysis of the imported sources
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/01-verify-manifest.py — Archive integrity check
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/02-run-verification.sh — Reproduction script for typecheck/tests/rebuild (not yet run)

## 2026-11-24

Replaced the zip and guide copies with an extracted, manifest-verified subset of the v6 workspace in sources/ir-source-workbench-v6 (src, docs, tests, scripts, config, v6 verification records; 2.8 MB). Excluded node_modules, dist and generated output; documented in sources/README.md.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/01-verify-manifest.py — Now also verifies the extracted tree against the manifest
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/sources/README.md — What was imported from the v6 archive and what was left out

## 2026-11-24

Imported Compiler Workbench: projects (typed → RV32) into sources/compiler-workbench-projects, unpacking its authored sources (book, reference, 44 projects, tests) from the generated bundles; round trip verified. Wrote analysis/02 (what it is + overlap matrix with v6) and design-doc/01 (combination proposal).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/analysis/02-compiler-workbench-projects-import-and-overlap-analysis.md — Compiler Workbench analysis and overlap with v6
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/01-combining-ir-workbench-v6-and-compiler-workbench.md — Proposal to combine both prototypes
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/03-verify-compiler-workbench-import.py — Round-trip verification of the import

## 2026-11-24

design-doc/01: added section 3.2, a per-module verdict on how much of v6 is taken (~2.9k lines lifted as code, ~1.1k re-expressed, ~1.9k left or deferred, ~6.4k dropped); revised the 'reimplement, do not merge' line accordingly.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/01-combining-ir-workbench-v6-and-compiler-workbench.md — Section 3.2 how much of v6 is taken

## 2026-11-24

Added design-doc/02: worked examples of the entire Typed → RV32 compiler on the v6 framework (IR chain, adapter, lowering tasks, dataflow analyses, rewrite rules, definePass passes, differential contracts, O2 and alternatives as strategies, tiling backend, wb API mapping) and the nine v6 extensions it needs.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/02-typed-to-rv32-compiler-on-the-v6-framework-worked-examples.md — Worked examples

## 2026-11-24

design-doc/01 section 3.2 revised: with the goal of defining the entire compiler on v6, the whole framework layer (core, strategy, contracts, ir; ~5.9k lines) is kept, including the task runtime and AnalysisManager used by design-doc/02. The cut list is the UI, domain stack, earlier labs, core/strategies.ts, their tests, scripts and history (~6.4k lines of src).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/01-combining-ir-workbench-v6-and-compiler-workbench.md — Revised keep/cut table

## 2026-11-24

Added design-doc/03: Candela → WGSL → Typed → RV32 as one artifact chain on the framework; generator records correspondence; exact per-scene facts via specialization, derived facts via verified transfer or guards; proposes Candela as the first real workload.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/03-candela-to-typed-to-rv32-as-one-artifact-chain-with-candela-facts-driving-passes.md — Candela chain design

## 2026-11-24

Typed domain on the framework: typed.blocks IR and adapter, CW lifting, evaluator and meaning check (E5), six analyses (E4), 11 passes (E3) and pipelines as Strategy plans (E6). Parity with the CW book: Blend O2 six revisions and s:blend.15 provenance; 44 projects / 70 functions: 6986 decided cases agree, 14 at the step limit. Found and corrected CW's false 'preserves loops' claims (lvn, dce, subst).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/passes.ts — the 11 passes as definePass
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/tools/parity.mjs — corpus parity report

## 2026-11-24

RV32 backend merged (tiling selection, linear scan, frames, encoding, rv32.image IR with correspondence); image parity after O2: Blend 88 bytes / 451 instructions, Checksum 52/366; program host (Program: apply, undo, why, check against r0 and image); Candela inventory (analysis/03); report 1 in the vault.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/backend/compile.ts — lowering typed.blocks to the RV32 image
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/program.ts — the program host

## 2026-11-24

Audit mode for preservation claims (1,376 applications; the prototype's lvn/dce/subst loops claims fail on 9/2/10 revisions); reference compiler pass groups vendored, chapters 13 and 14 reproduced (5,160 vs 7,628 bytes; 6,986/6,986 cases); specialization on outer facts (typed.bindings, restricted contract, because-chain to the fact).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/specialize.ts — specialization under assumptions
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/tools/audit-preservation.mjs — checks every preservation claim

## 2026-11-24

Strategies as checked data: typed.metrics, strategyRegistry, chooseBest plans, runStrategy publishes the winning chain; user passes via the prototype's builder; short-form strategies and presets; tile-width (72 columns) formatting of everything the workbench shows (88 corpus files reformatted with meaning and Markdown-block checks).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/format.ts — tile-width formatting
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/strategies.ts — strategies, metrics, presets

## 2026-11-24

Ordering search over the corpus: 12/44 projects faster than O2 (-2.2% instructions, 5,160 -> 5,092 bytes); 11 of 12 gains are one extra subst after O2 (the book's t = i copy where bce removed the check); per-function search never beats per-program choice on this corpus. Merged the browser workbench (UI subagent) and f32 + Candela lifting (f32 subagent: 332 functions, 0 disagreements with the reference image, O2 13 revisions, -23% statements). Fixed typedTape registration in the page. Reports 2 and 3 in the vault. Design-doc 04 (16 optimization ideas).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/f32.ts — f32 semantics
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/tools/search-experiment.mjs — the corpus ordering experiment
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/design-doc/04-optimization-ideas-what-the-framework-makes-possible-from-candela-to-rv32.md — optimization ideas

## 2026-11-24

O2+ pipeline (O2 then subst): faster than O2 on 11 projects, slower on none, no image grows; corpus 77,321 -> 75,681 instructions, 5,160 -> 5,104 bytes; O2 unchanged for parity.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/passes.ts — PIPELINES O2+

## 2026-11-24

Framework performance (no hash changes): immutable builds canonical copies directly; canonical text and fingerprints cached for deep-frozen canonical values; validation skipped for values immutable produced; structural comparison in project; verified-artifact and projection caches. Candela: no-change pass 86 s -> 18 s, cfg 101 s -> 31 s; corpus r0/O2/image revisions identical on 44 projects.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/framework/core/data.ts — canonical data, caches
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/08-corpus-revisions.mjs — revision fingerprint of the corpus for equivalence checks

## 2026-11-24

bcm, bounds-check merging for checked text addresses: per block and receiver, positions base + constant (exact mod 2^32) keep only the smallest and largest checks (constant positions: the largest). Candela r0: 559 caddr -> 100, contract accepted. Revised design-doc 05's dominating-test plan after measuring that generated code indexes rows by computed positions.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/passes.ts — bcm
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/tests/typed/bcm.test.mjs — bcm tests

## 2026-11-24

Candela oracle against the reference kernel policy: 33,200 cases, 32,985 agree, 0 disagree, 215 at the step limit (same as stock).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/tools/candela-oracle.mjs — --policy option

## 2026-11-24

Candela rendering: gallery scene table vendored as data; CandelaHost (port of ds-js-os host.mjs) with reference-image (emulator) and evaluator engines; tools/candela-render.mjs writes PNG views. B-01 renders; evaluator at r0 and at the O2 head bit-identical to the emulator (19,200 floats). Candela O2 after the framework speedup: 19 min (was 36).

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/candela-render.ts — scene table, host protocol, views
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/tools/candela-render.mjs — render tool

## 2026-11-24

IRWB-002 created by a Fable subagent and merged: intern guide (Part 1, the system from the code) and research agenda (54 items, ten workstreams), uploaded to reMarkable /ai/2026/11/25/IRWB-002 (verified by listing).

## 2026-11-24

Candela view merged (UI subagent): Layout -> Candela renders any of the 18 scenes on the emulator (reference image, kernel/stock) or the evaluator (r0 or the open project's revision), progressive, with stats and bit-for-bit comparison across engines; Candela data and the reference compiler load on demand with SRI.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/site-src/candela.js — the Candela view
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/workbench/candela.ts — engines and progressive render

## 2026-11-25

P4.3 per-scene Candela kernels: field bindings (K.scene), entry-only contracts (Program entries, MeaningParams.roots), dfe; all 18 scenes 135-147 of 332 functions and frames bit-identical; B-01/R-01 images 42% of general, 5-6% fewer instructions per pixel; O2+ after dfe < 1%. Our RV32 image as a render engine (workbench + CLI). Design-doc 05 section 9 records outcomes and departures.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/passes.ts — dfe
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/src/typed/specialize.ts — field bindings
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/24/IRWB-001--ir-workbench/scripts/13-candela-per-scene-images.mjs — per-scene images, O2+ and checks
