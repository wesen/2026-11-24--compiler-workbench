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
