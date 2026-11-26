## 1

I’ll use the docmgr and diary skills, then check the corpus conventions and f32 execution paths before writing the design.

## 2

The front end and lifter support packed f32 buffers and `Math.sqrt`. I’ll use those to make FFT twiddles depend on the input size, and use the raw run results for checks so they cover every output word.

## 3

The design now specifies both kernels, the packed inputs, and the exact and dB checks. I’ll validate the ticket and confirm the commit contains only its files.

## 4

- Design doc: [01-f32-dsp-corpus-project.md](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-016/ttmp/2026/11/26/IRWB-016--f32-dsp/design-doc/01-f32-dsp-corpus-project.md)
- Ticket: [IRWB-016](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-016/ttmp/2026/11/26/IRWB-016--f32-dsp/index.md)
- Commit: `07592d20e25ee4f6ef4fdc7cb5c42ae4b51777eb`

The design specifies an 8-, 16-, or 32-point iterative f32 FFT and a three-section biquad bank. It defines packed input buffers, generated cases, bit-exact checks against r0 and the reference RV32 image, and a float64 JavaScript oracle with proposed dB limits for reassociation and FMA. It also gives an implementation and measurement plan for specialization and instruction counts. The step estimates and dB limits await validation during implementation. The commit contains only ticket files.
