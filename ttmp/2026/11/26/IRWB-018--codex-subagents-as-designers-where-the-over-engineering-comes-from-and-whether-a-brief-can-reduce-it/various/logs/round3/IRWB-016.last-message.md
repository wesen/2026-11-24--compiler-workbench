Committed as `06bdc7e2cebb68157e20a7b82d8d027287f74ce5`. The commit contains only IRWB-016 files, including the updated diary.

- Reduced the bank from three biquads to two. Two still exercise distinct coefficient rows and outputs.
- Packed both sections into one output prefix with one untouched tail.
- Replaced malformed-input handling and tests with host preconditions for valid DSP calls.
- Replaced the span-4 special case and sine division with one half-angle update.
- Reused a generated coefficient bank for specialization instead of maintaining a separate fixed table.
- Consolidated validation and measurement into one Node replay script, removing the separate workbench script and redundant metadata.
- Removed the standalone butterfly oracle and alternate reference-run path. The kernel oracles and signature-aware exact replay cover the helper.
- Replaced two dB gates with one peak-error bound that also bounds RMS error. The threshold still needs calibration against r0.
- Trimmed overlapping fixtures and sample schedules while keeping endpoint, spectral, exact-edge, and FMA cases.
- Condensed the step-budget worksheet into a sizing estimate and a measured headroom check.
- Dropped guarded specialization, the hand-tuned sibling project, and exhaustive backend ablations from the experiment plan.
- Removed duplicate references and reporting instructions.