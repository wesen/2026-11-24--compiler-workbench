# Review of doc A

## Must change

1. **State the relation you actually enforce.** "For finite `s`, require finite `g` and `abs(g - s) <= B(s)`. When `r` is also finite, require `abs(g - r) <= max(B(r), abs(s - r) + B(s)/8)`." By the triangle inequality the second clause holds whenever `abs(g - s) <= B(s)/8`. So the governing bound is the distance to the f32 result, not a tolerance against f64 as the brief asks. The 1/8 constant is justified on "2,048 rows of 32 values … with corpus verification still to come", not on the contract's own cases. Write the relation in one line and justify its constants on the cases `checkLowering` generates. For reference (my local check): on the stage-1 tolerance cases, the f32 meaning of every corpus program (original and optimized) uses at most 25% of `B(r)` against f64.

## Cut

1. "Add an `--identity` query and an optional `--expect-identity` … On a warm check the identity query runs". The memo is process-local; this adds an SSH round trip per check to catch a mid-process toolchain change.
2. "The local runner also coalesces identical in-flight checks under the same keys". No caller of the fixed API needs this.
3. "A small device struct carries bound dimensions and a pointer per tensor." The parameter-block worry is speculative; pass shapes and pointers as kernel parameters.

## Framework and tool changes

- No framework change: correct. `execute` takes differently typed ports and awaits an async `ensures`. `decide`, `baselineKey` and `subjectKey` already batch the cases and replay verdicts.
- `--input cases.bin`, kept out of the compile key: needed, minimal, correctly placed.
- Per-invocation directory, compile lock, atomic install: needed once the data leaves the key.
- `--identity`: not needed.

## Keep

Keep the `__f*_rn` rounding sites, the literal bits, the JS min/max rule, the single `decide` batch, and "load kernels with `cudaFuncGetAttributes` before timing". In my probe on the GB10, a kernel's first event interval in a process was 0.115 ms and its second 0.003 ms; with that preload the first was 0.004 ms.
