## 1

I’ll use the docmgr and diary skills to create IRWB-013, verify the design against the Typed compiler and corpus tooling, and commit only the ticket directory.

## 2

The probe found that frame arrays work through tape ingestion, which the browser project loader already supports. The Node corpus loaders currently ignore that setting. I’ll document the small loader change needed for automatic discovery and the path that runs today through `Program` directly.

## 3

The design now specifies both kernels, their input layouts, and byte-for-byte checks. Node crypto reproduced the listed known answers. I’ll validate the ticket metadata and review the staged files before committing.

## 4

- [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-013/ttmp/2026/11/26/IRWB-013--sha-256-and-chacha20/design-doc/01-sha-256-and-chacha20-corpus-design.md)
- [IRWB-013 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-013/ttmp/2026/11/26/IRWB-013--sha-256-and-chacha20/index.md)
- Commit `b47b6e9d1baabed57821d33a51b2dba6c2f63f88`

The design specifies one corpus project with SHA-256 for messages up to 119 bytes and a ChaCha20 block function with 16 live state words. It defines buffer layouts, generated cases, byte-for-byte oracle checks, and RV32 instructions-per-byte measurements. Small probes confirmed tape ingestion and identified the headless loader change needed for corpus discovery. The kernel step budgets remain estimates. Docmgr validation passed, and the commit contains only the ticket files.
