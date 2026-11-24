---
Title: Diary
Ticket: IRWB-001
Status: active
Topics:
    - compiler
    - ir
    - workbench
    - typescript
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological work log for IRWB-001 (IR Workbench)."
LastUpdated: 2026-11-24T18:40:00-05:00
WhatFor: "Resume point and reasoning trail for the ticket."
WhenToUse: "Read the newest entry when resuming work on IRWB-001."
---

# Diary

<!-- Log entries in reverse chronological order (newest first) -->

## 2026-11-24 - Imported Compiler Workbench: projects; overlap and combination proposal

**Goal.** Import `~/Downloads/Compiler Workbench_ projects.zip`, explain what it is, measure its overlap with v6, and propose how to combine the best of both.

**Done.**
- The user typed the file as `Compiler Workbench_projects.zip`; the actual name has a space after the underscore.
- The zip (26 files, 1.4 MB) holds only the built site. Its authored sources live inside generated bundles: `app/sources.js` embeds 42 files, including the book Markdown, the reference and the test scripts, and `app/content/projects.js` packs 44 projects.
- Unpacked those bundles back into the repo layout that `test/build.mjs` expects (`site/`, `src/{book,reference.md,projects}`, `test/`) under `sources/compiler-workbench-projects/`: 237 files, 2.0 MB. The four generated bundles were left out.
- `scripts/03-verify-compiler-workbench-import.py` re-derives the bundle contents from the imported files and compares them with the zip. The round trip is OK; only the `<title>` of `index.html` differs between the embedded and shipped copies.
- Wrote `analysis/02` (what it is, plus an overlap matrix) and `design-doc/01` (combination proposal and phases).

**Findings.**
- This prototype was also built by Claude, as a claude.ai artifact project: the paths are `/home/claude/wb2`, and the agent uses `claude.use('sample')`.
- It reuses the Typed front end and the RV32 tools from the user's `ds-js-os`. The reference compiler now lives at `ds-js-os/compiler/typed/typed-rv32.js`, not the `picocalc-os/compiler/` path the tests hard-code. The vendored `typed-wasm.js` is older than the current one in ds-js-os.
- The two prototypes share no code. Conceptually they overlap in the middle layer: revisions, transactions, provenance, declared writes and preservation, stale facts, check-before-accept, and self-reading. Otherwise they are complementary: v6 is broad and generic, CW is deep and usable.

**Decision proposed (not yet taken).** Use CW's product shape and its Typed → RV32 compiler as the flagship, on a kernel shaped by v6's abstractions. Reimplement in strict TypeScript, using CW's 44 projects as the parity corpus. Bring in v6's breadth in phases.

**Not done.** The Compiler Workbench site was not run, for the same reason as before: it is downloaded code, and running it needs path fixes first. Nothing was committed in this step; the user's earlier commit request covered only the v6 import.

## 2026-11-24 - Replaced the zip import with an extracted source subset; committed

**Why.** The user asked to unzip and import the relevant files instead of the archive, clean up, and commit only what is worth committing.

**Done.**
- Extracted 200 files plus `WORKSPACE-MANIFEST.json` (2.8 MB) into `sources/ir-source-workbench-v6/`. The subset is `src/`, `docs/`, `tests/`, `scripts/`, the READMEs, `IMPLEMENTATION.md`, `package*.json`, `tsconfig.json`, `requirements-docs.txt` and five small v6 verification records from `output/`.
- Left out `node_modules/` (261 files), `dist/` (319) and the rest of `output/` (186 files, ~143 MB, including the 11.7 MB HTML, the PDFs and the 50 MB traces). All of it can be regenerated, and `sources/README.md` documents it.
- Deleted the docmgr-imported copies in `sources/local/`: the 34 MB zip and the guide, which is byte-identical to `docs/v6-user-guide.md`. The originals are still in `~/Downloads`. ExternalSources and `.meta/sources.yaml` still record where they came from.
- Extended `scripts/01-verify-manifest.py` with a tree mode. The imported subset matches the manifest: 200/200 files, 0 mismatches.
- Repointed the RelatedFiles of the index and the analysis at the extracted tree, and removed the "archive handling" open question.
- Committed the ticket and the vocabulary change on a branch, because the repo is on `main`.

**Note.** docmgr does not index or flag the plain `.md` files under `sources/` (doctor is clean), so no ignore rule was needed.

## 2026-11-24 - Ticket created, v6 sources imported and analyzed

**Goal.** Create a ticket for building an IR workbench. Import the v6 prototype (`ir-source-workbench-v6-complete.zip`) and its user guide (`ir-workbench-v6-user-guide.md`) from `~/Downloads`, and explain what they are.

**Done.**
- Initialized vocabulary: topics `compiler`, `ir`, `workbench`, `typescript`; docType `analysis`.
- Created ticket `IRWB-001` and imported both files with `docmgr import file`. They now live in `sources/local/` and are listed in `index.md` ExternalSources.
- Extracted the archive, without `node_modules`, into the session scratchpad for reading only. Nothing from the archive was extracted into the repository.
- Read the guide's chapters 1–4 and 8–11 plus selected passages of 5–6, the READMEs from every version, `IMPLEMENTATION.md`, `src/core/types.ts`, `src/ir/types.ts`, `planIRLab` in `src/ir-examples/lab.ts`, the export lists of the main modules, and the build scripts.
- Wrote `analysis/01-ir-workbench-v6-import-analysis.md`.

**Evidence gathered.**
- `scripts/01-verify-manifest.py`: the zip CRC is OK and all 971 manifest entries match bytes and SHA-256. No extra files.
- The imported guide is byte-identical to `docs/v6-user-guide.md` in the archive (`cmp`).
- Static grep found no network APIs in `src/`, `scripts/` or `tests/`. `child_process` is used only to spawn `node`/`tsc`.
- The archive's own logs record 371/371 tests passing (`output/v6-release-validation.log`). The earlier `v6-tests.log` shows 370, and `v6-test-initial.log` shows 297/298. This is consistent with tests being added late in the release.

**What did not work.**
- Running `scripts/02-run-verification.sh` (extract, `tsc --noEmit`, `node --test`, rebuild, retest) was denied by the session's auto-mode permission classifier, because it executes code from a downloaded archive. I did not work around the denial. The claimed test results therefore remain unreproduced, and the user can run the script.

**Tricky points.**
- Line counts understate the code size: `src/` is 14.7k lines but about 1 MB, because several UI and builder files are written as very long lines.
- The 34 MB zip now sits inside `ttmp/` and would be committed with the ticket unless it is gitignored or moved to LFS. This decision is left to the user.

**Next.**
- The user decides on reuse vs. reimplementation, which layers come first, target IRs and archive handling (analysis §9).
- Optionally run `02-run-verification.sh` and open `output/source-workbench.html` in a real browser. Neither has ever been done for v6.
