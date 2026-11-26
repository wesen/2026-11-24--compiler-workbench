## 1

I’ll use the docmgr and diary skills to create IRWB-016, then verify the Typed and corpus features the DSP design will rely on.

## 2

The probe confirmed that packed f32 buffers and float calls work through the loader and both RV32 paths. The generic reference checker drops the float signature, so the design will use the signature-aware reference runner for comparison.

## 3

The design and diary pass docmgr validation. The sandbox blocked staging at the worktree’s Git index, so I’ll request escalation for the ticket-only commit.

## 4

- **Design** [01-f32-dsp-corpus-playground.md](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex2-irwb-016/ttmp/2026/11/26/IRWB-016--f32-dsp-corpus-playground/design-doc/01-f32-dsp-corpus-playground.md)
- **Ticket** [IRWB-016](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex2-irwb-016/ttmp/2026/11/26/IRWB-016--f32-dsp-corpus-playground/index.md)
- **Commit** `9cdbd6bae7a0ffe429f71e8ca0bfea1495330ed5`

The design specifies an in-place 8- or 16-point radix-2 FFT and a two-band, 16-sample biquad bank. It defines valid generated inputs, bit-exact checks against r0, an independent float64 JavaScript oracle with a proposed −100 dB tolerance, and an RV32 instruction-count comparison for the general and size-specialized FFT. A small probe verified the required Typed and loader features and exposed a reference-checker signature issue documented in the design. The commit contains only the ticket documents.
