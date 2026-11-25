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
