## Your task (B1): specialize the bytecode VM on its bytecode, a first Futamura projection
The bytecode VM (`corpus/projects/bytecode-vm/`, ticket `ttmp/2026/11/26/IRWB-012--bytecode-vm/`) runs a bytecode program from a buffer. Hand-specialized loops for its two programs take 75 and 74 instructions, against 7,678 and 6,874 for the general VM. The existing specialization (IRWB-009 and IRWB-010, `src/typed/specialize.ts`) binds scalar values and fields, not memory, and binding scalars here gains almost nothing.

- **Specialize on a constant buffer:** a host promise that a buffer's contents are fixed, checked as the field binding is checked, and a binding-time analysis that propagates it through loads from that buffer.
- **Specialize the dispatch loop** on a known program counter: when to unroll it, how to stop, and how the result stays checked by the meaning contract.
- **Measure how much of the gap** to the hand-specialized 75 and 74 instructions automatic specialization closes, and what it costs in code size.
- **New approaches are welcome,** for example polyvariant specialization with a size budget, or a check that the promise holds at run time. Report what worked and what did not.

## Measure and report
- the binding-time analysis and the dispatch-loop specialization, with their checks;
- instructions and code size of the specialized VM for both programs, against the general VM and the hand-specialized loops;
- what stops the specialization, and where it falls short;
- the framework changes, each with its reason;
- which results you measured and which you only argued.

## Final message
- the ticket, design and report paths;
- the instructions and code size for both programs: general, specialized, hand-written;
- the framework changes;
- the last commit hash.
