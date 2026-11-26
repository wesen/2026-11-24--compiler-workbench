## 1

I’ll use the diary skill to record the review. I’ll reread the design against the worktree’s compiler and corpus files, then cut anything that doesn’t help implement, check, or measure the two kernels.

## 2

The single-block SHA path still exercises all 64 rounds, the message schedule, and a runtime constant table. I’ll use that narrower workload, keep ChaCha’s 16-word register-pressure case, and trim the extra oracle and benchmark variants around them.

## 3

Commit `3010f02f09d674d2174e462db3e3665fd96068b0`. Only the IRWB-013 ticket files changed, including the diary.

- Limited SHA-256 to one padded block. It still runs the full message schedule and all 64 rounds.
- Made ChaCha’s setup constants literals. SHA’s runtime round table supplies the specialization experiment.
- Removed malformed-input handling, byte-cell masking, and their tests. The corpus harness supplies valid buffers.
- Replaced the alternate-table generator and dispatcher with one modified-table fixture and an explicit specialization precondition.
- Dropped the extra host oracles and separate vector script. One host test uses published vectors and the framework SHA implementation.
- Trimmed the case matrix and step worksheet to representative fixtures, generated checks, and measurements against the existing cap.
- Reduced timing to one fixture per kernel, three revisions, and one reduced-register comparison.
- Consolidated the optimization notes and implementation checklist around observable compiler effects.
