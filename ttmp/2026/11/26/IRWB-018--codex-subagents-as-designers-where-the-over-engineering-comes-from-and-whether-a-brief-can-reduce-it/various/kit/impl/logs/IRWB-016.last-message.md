Implemented [f32 DSP](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-016/corpus/projects/f32-dsp/) with an in-place radix-2 FFT for sizes 8 and 16, a two-band biquad bank, and a fresh-workbench instruction comparison script. Updated the [ticket diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-016/ttmp/2026/11/26/IRWB-016--f32-dsp-corpus-playground/log/01-diary.md), tasks, and changelog.

- `npm run build` passed.
- `node --test --test-isolation=none tests/typed/f32-dsp.test.mjs` passed all three [tests](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/impl-irwb-016/tests/typed/f32-dsp.test.mjs). The exact checks matched returns and complete guest memory. The worst binary64 oracle error was −138.92 dB against a −100 dB bound.
- `node tools/parity.mjs --json f32-dsp` reported 300/300 agreements with zero rejected passes or inconclusive cases.

| Kernel | r0 instructions | `speed` instructions |
|---|---:|---:|
| FFT, size 8 | 1,591 | 1,544 |
| FFT, size 16 | 4,154 | 4,065 |
| Biquad bank | 1,464 | 1,096 |

Binding the FFT length to 16 replaced five reads of `n` and reduced the `speed` image to 4,064 instructions on identical inputs.

The design proposed a change to the corpus-wide reference CLI. The scoped test calls the signature-aware stock reference runner directly, as recorded in the diary.

Commits `dc6c6c4` and `a3126e9`. The worktree is clean.