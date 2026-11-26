## 1

I’ll use the docmgr and diary skills, then read the corpus and checker code to ground the design. I’ll keep all changes inside IRWB-014 and commit only that ticket.

## 2

The corpus and checker support a small full-u16 codec with two fixed frame arrays. I’ll specify the wire format and give the decoder both valid and malformed generated cases, so the pass gate exercises copying as well as error handling.

## 3

The sample metadata, internal links, token arithmetic and step-budget sum checked out. `docmgr doctor` also checks the diary’s frontmatter, so I’ll add that metadata and rerun validation before committing.

## 4

- [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-014/ttmp/2026/11/26/IRWB-014--lz-style-compressor-and-decompressor-corpus-program/design-doc/01-designing-an-lz-style-compressor-and-decompressor-for-the-corpus.md)
- [IRWB-014 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-014/ttmp/2026/11/26/IRWB-014--lz-style-compressor-and-decompressor-corpus-program/index.md)
- Commit `43baa4bd961af04ca33a76e56aa077235dddf568`

The design specifies a Typed LZ codec for up to 32 UTF-16 code units, with a bounded hash chain, packed match tokens, and overlapping back-references. It includes an independent JavaScript decoder, exact round-trip fixtures, generated inputs, and an RV32 instruction-count plan. The 20,000-statement gate is addressed with a sizing estimate to verify during implementation. `docmgr doctor` passed, and the commit contains only ticket files.
