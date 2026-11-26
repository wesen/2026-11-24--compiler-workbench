## 1

I’ll use the docmgr and diary skills to create IRWB-016, then verify the Typed features, case generator, and checker before writing the design.

## 2

A small probe confirmed that packed f32 buffers and a two-field value record work through the lifter, evaluator, and both RV32 images. The design will use those features and keep the existing bit-exact pass gate while specifying a separate float64 accuracy check.

## 3

The design now includes the generated cases, statement budget, and a rounding witness that fails exact comparison while passing the proposed −100 dB bound. The JSON example and source links validated. Docmgr flagged the diary filename, which I’ll fix before committing the ticket.

## 4

- [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-016/ttmp/2026/11/26/IRWB-016--f32-dsp/design-doc/01-f32-dsp-corpus-program.md)
- [IRWB-016 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/round4-irwb-016/ttmp/2026/11/26/IRWB-016--f32-dsp/index.md)
- Commit `427304103c56ced5458f12db6fc4f6fae6f645ec`

The design specifies one Typed corpus project with an iterative radix-2 FFT and a three-channel biquad filter bank. It defines packed f32 inputs, generated cases, bit-exact checks against r0 and the reference RV32 image, and a proposed −100 dB bound against independent float64 DFT and convolution oracles. It also identifies the buffer constants for future specialization and gives an RV32 instruction-count measurement plan. A small probe verified the required Typed features end to end. The full kernels and their estimated statement budgets await implementation. Docmgr validation passed, and the worktree is clean.
