## 1

I’ll use the docmgr and diary skills to create IRWB-014, then check the corpus and Typed implementation before writing and committing the design.

## 2

The normal corpus loader rejected a small frame-array probe with `unknown tape opcode 252`. I’ll design the hash tables as caller-supplied scratch buffers so the project can use the existing loader and reference checker.

## 3

The draft now specifies the token layout, valid decoder inputs, and the round-trip oracle. A six-buffer probe using the proposed case generator agreed across the evaluator and both RV32 images on 40 cases. I’ll finish the ticket links and validate the commit scope.

## 4

- [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-014/ttmp/2026/11/26/IRWB-014--lz-style-compressor-and-decompressor-corpus-project/design-doc/01-lz-style-compressor-and-decompressor-corpus-design.md)
- [Ticket IRWB-014](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-014/ttmp/2026/11/26/IRWB-014--lz-style-compressor-and-decompressor-corpus-project/index.md)
- Commit `44847139ce7890ab8abced16c724e8af1cbb3954`

The design specifies one Typed corpus project with bounded hash-chain search, packed literal and match tokens, and forward decoding of overlapping matches. It defines generated cases, an independent byte-for-byte round-trip oracle, and a plan to compare RV32 instruction counts across r0, O2, and `speed`. Small probes confirmed the scratch-buffer layout works with the normal corpus loader and both RV32 compilers. The step budget remains an estimate for implementation. Docmgr validation passed, and the commit contains only the ticket files.
