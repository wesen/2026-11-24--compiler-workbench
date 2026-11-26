## 1

I’ll use the docmgr and diary skills to create IRWB-014, then check the corpus, validator, and Typed features the design will rely on before writing and committing the ticket.

## 2

The case generator can supply a fixed valid stream for standalone decoder checks and varied inputs for the round trip. That keeps every function checkable through the existing corpus loader. I’ll verify that setup with a small Typed probe.

## 3

The probe found one loader gap. The browser workbench honors `ingest: { tape: true }`, which frame arrays need, but the Node corpus loader ignores it. Both RV32 backends agreed with the evaluator when the probe used tape ingestion explicitly. The design will specify the small loader change needed for corpus integration.

## 4

The design is within the requested length, and docmgr and the local links check out. Git’s index is read-only in the sandbox, so I’ll request elevated access for the ticket-only commit.

## 5

- [IRWB-014 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex2-irwb-014/ttmp/2026/11/26/IRWB-014--lz-style-compressor-and-decompressor/index.md)
- [LZ-style compression design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex2-irwb-014/ttmp/2026/11/26/IRWB-014--lz-style-compressor-and-decompressor/design-doc/01-lz-style-compression-corpus-project.md)
- Commit `95fd5c2edb2031df6a519a76bf4945fd7f9c8433`

The design specifies a bounded hash-chain compressor, single-byte tokens, and a decoder that copies overlapping back-references. It defines generated inputs, an exact round-trip oracle, and an RV32 instruction-count comparison. Small probes verified the required Typed features and identified where the Node corpus loader needs to forward the tape-ingestion option. The commit contains only ticket documentation. Codec implementation and measurements remain future work.
