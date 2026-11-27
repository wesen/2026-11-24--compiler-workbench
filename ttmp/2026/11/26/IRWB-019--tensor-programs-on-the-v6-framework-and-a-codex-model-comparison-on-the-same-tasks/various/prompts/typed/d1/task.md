## Your task (D1): why `speed` makes the bytecode VM slower
At `n = 12, seed = 8`, the `speed` pipeline takes the bytecode VM project's Fibonacci from 7,678 to 9,286 RV32 instructions, and its checksum from 6,874 to 8,218. It is the only one of the six programs of IRWB-012 to IRWB-017 that the optimizer makes worse (`ttmp/2026/11/26/IRWB-012--bytecode-vm/`, `corpus/projects/bytecode-vm/`).

- **Find the cause from the compiler's own records, not by guessing.** Every executed instruction maps back through correspondence to the passes and rules that produced it. Build the attribution: credit executed instructions (or their difference against r0) to the decisions that caused them, and show which decision costs the extra instructions (an inline, an unroll, a hoist and its register pressure, or something else).
- **Then fix it in the compiler:** a guard, a cost check, or a better decision. The bytecode VM's instructions under `speed` at or below r0's, no regression in the corpus totals of the other projects, and parity clean.
- **The attribution is a tool, not a one-off:** the next stage (missed optimizations from provenance) reuses it. Make it a function or tool other code can call, with a test.
- **New approaches are welcome,** for example attribution that follows instructions through several passes, or a cost model checked against the emulator's counts. Report what worked and what did not.

## Measure and report
- the attribution: method, and the table of decisions and the instructions credited to each, for the bytecode VM under `speed`;
- the fix and its reason;
- instructions per corpus project under O2 and `speed`, before and after;
- the framework changes, each with its reason;
- which results you measured and which you only argued.

## Final message
- the ticket, design and report paths;
- the cause, and the fix;
- the bytecode VM's instructions under r0, O2 and `speed`, before and after, and the corpus totals;
- the framework changes;
- the last commit hash.
