## 1

I’ll use the docmgr and diary skills to create IRWB-013, check the design against the current compiler and corpus harness, and commit only the ticket directory.

## 2

The corpus loader supplies generated cases for every function, including helpers. I’ll give the rotate helpers explicit input ranges, and I’m checking whether a four-word value record lets ChaCha20 share one quarter-round helper while keeping its 16 state words in locals.

## 3

The probe confirmed that frame arrays and four-word results work through tape ingest and both RV32 backends. It also exposed two gaps in the Node corpus path: it drops the project’s ingest setting, and the reference checker needs signatures to compare multiword results. The design will specify both fixes.

## 4

The design and diary pass docmgr validation. I’ll check the staged paths and commit the six files under IRWB-013.

## 5

- [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex2-irwb-013/ttmp/2026/11/26/IRWB-013--sha-256-and-chacha20/design-doc/01-sha-256-and-chacha20-corpus-project.md)
- [Ticket IRWB-013](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex2-irwb-013/ttmp/2026/11/26/IRWB-013--sha-256-and-chacha20/)
- Commit `59e24dcefff2a3ddd4aa9bc9f515969040e3a33f`

The design specifies one corpus project with a single-block SHA-256 hash and a ChaCha20 block function with 16 live state words. It covers Typed layouts, generated inputs, published vectors, the framework SHA-256 oracle, the 20,000-statement budget, and RV32 instructions per byte. Small probes confirmed tape ingest and multiword results and identified two integration changes for implementation. Docmgr validation passed, and the commit contains only ticket files. A metadata lookup also displayed part of the IRWB-003 diary beyond the requested reading scope.
