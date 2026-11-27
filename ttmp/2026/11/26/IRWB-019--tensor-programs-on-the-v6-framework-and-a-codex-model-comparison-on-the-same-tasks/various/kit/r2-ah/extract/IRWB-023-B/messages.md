## 1

I’ll use the docmgr and diary skills for IRWB-023-B. I’ll read the two earlier designs and final reports first, then use the implementation to choose a hypothesis I can test against Tix’s f32 meaning.

## 2

The earlier reports identify a useful target. Tix specifies the order of every f32 addition, and an ordinary parallel sum can change its answer. I’ll test whether a GPU can execute parts of that ordered fold in parallel when the accumulator stays within one floating-point exponent range. The ticket is open, and Node 24.18.0 and docmgr are available.

## 3

The build passed. The Tix interpreter returned 1 for the half-ULP witness, and the GB10 probe confirmed round-to-nearest-even addition and warp shuffle on sm_121. I also found a 2007 FPGA paper that already reproduces sequential floating-point sums in parallel. I’ll compare its iterative correction idea with a bounded chunk certificate and a simpler ordered GPU kernel.

## 4

At 4096×1024, the fused kernel with one thread summing each row matched all 4,194,304 output words and took about 0.362 ms, versus 0.741 ms for the generated kernels. The chunk certificate also matched every word but was essentially tied with the simpler kernel. Even the incorrect tree saved little time. I’ll test whether the rounded exponential is the more valuable target.

## 5

A 1,024-word probe near −1 distinguished the exponential candidates. CUDA `expf` disagreed with the rounded-double reference on 632 words. A small cubic table approximation agreed on all 1,024. I’ll enumerate the active negative-input range to see whether that agreement holds and, if it fails, how many exceptions a checked implementation would need.

## 6

The full active-range sweep found one failing input for both the 1,024-cell cubic and the 128-cell quartic. At `x = -14.567090034484863`, each returned `0x34fd331a`; Node returned `0x34fd331b`. I’ll patch that word, verify the deployed routine against Node across the entire nonpositive domain, and time it inside softmax.

## 7

The patched cubic and quartic passed the independent Node comparison over all 2,139,095,041 negative-sign encodings from −0 through −∞. In full softmax, the cubic matched every output and reduced the median from 0.755 to 0.192 ms. Both approximations missed the same input and used the same table entry there, so I’ll test whether adjusting that entry can remove the runtime patch.

## 8

The fitting experiment removed the exceptional-input branch. A 16,384-cell quadratic needed one table entry moved by four binary64 ULPs. The final kernel took 0.175 ms against 0.745 ms for generated CUDA and 0.141 ms for a matched streaming control. Its full-size output digest matched `runTix`. I’ll test whether the same four-statement region helps attention when the surrounding contractions stay in place.

## 9

The same region reduced full attention from 1.046 to 0.757 ms. All 65,536 output words matched `runTix`, and the relinked attention executable passed its own scalar audit. The smaller gain makes sense: the optimized middle took 0.047 ms, while the two contractions still use the generated kernels. I’m checking the receipts, document links and final ticket metadata now.

## 10

**Exact softmax ran 4.25× faster on the GB10.** At 4096×1024, the prototype took **0.175 ms** versus **0.745 ms** for generated CUDA and **0.141 ms** for a matched streaming kernel. All 4,194,304 output words matched the public Tix f32 interpreter. Reusing the same optimization inside attention gave a **1.38×** whole-program speedup.

[Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-ah-irwb-023-b/ttmp/2026/11/26/IRWB-023-B--exact-parallel-folds-for-tix/design-doc/01-parallel-execution-of-the-ordered-f32-fold.md) · [Research diary](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/r2-ah-irwb-023-b/ttmp/2026/11/26/IRWB-023-B--exact-parallel-folds-for-tix/reference/01-investigation-diary.md)

### Top three proposals

1. **Fit intrinsics to Tix’s observable f32 result.** Use the IR to establish the argument domain, fit coefficients to the required output words, and exhaustively check the deployed binary against Node.
2. **Fuse row-local tensor definitions while preserving the ordered sum.** Build this first. It roughly halved softmax time using the existing exponential and supplied the control for every subsequent optimization.
3. **Use guarded chunk transfers for long ordered sums.** Keep this experimental. The method reproduced the sequential fold, but its bookkeeping cost more than it saved on the measured GPU workloads.

### Experiments

| Experiment | Result |
|---|---|
| Interpreter and GPU rounding probes | Both returned exactly 1 on the half-ULP tie. |
| Four-bit arithmetic model | All 8,444 guarded translations agreed. Removing parity, path or boundary checks produced counterexamples. |
| Binary32 chunk transfers | All 194,670 chunk endpoints agreed. A nonnegative-term refinement recovered all 4,010 half-ULP replays at width 32. |
| GPU reduction ablation | Ordered fusion took 0.362 ms. Speculative chunks took 0.363 ms. The ordinary tree took 0.356 ms and changed 3,822,368 outputs. |
| Exponential sweep and midpoint diagnosis | Two candidate polynomials each missed one of 265,289,728 active inputs. Its exact exponential lay about 1.27 binary64 ULPs above a binary32 midpoint. |
| Coefficient fitting | Moving one table entry by four binary64 ULPs made a 16,384-cell quadratic feasible. Pairs of incompatible inputs ruled out 659 cells of the smaller quadratic. |
| Independent scalar audit | Three deployment executables matched Node’s output digests across all 2,139,095,041 negative-sign encodings from −0 through −∞. |
| Contract mutation | The existing tolerance gate accepted two incorrect kernels. One changed 63 sampled words; the other first failed at width 33, beyond the sampled widths. |
| Region recognition and v6 checks | The recognizer found softmax and attention in the six-program corpus. The schedule gate accepted two valid cases and rejected ten mutations. |
| End-to-end softmax | All 8,544,452 words across 15 public-interpreter calls matched, including extreme logits, empty dimensions and the width-1025 fallback. |
| End-to-end attention | Full attention fell from 1.046 to 0.757 ms. All 65,536 full-size outputs and all 21 asymmetric small-case outputs matched the interpreter. |

The exhaustive guarantee applies to the audited scalar routines on the recorded GB10 and Node profiles. Whole-program agreement was measured on the reported inputs.

Final commit `a4d61b88ccb114aea3bce7b2ba91b1188ad97585`. All five commits are local, the worktree is clean, and every changed file is under IRWB-023-B.
