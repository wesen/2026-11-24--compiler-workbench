# Review of doc E

## Must change

1. **The subject key names inputs that nothing supplies.** "the target profile (host, architecture, toolchain, flags, runner/protocol version)". The tool reports neither the toolchain nor the driver, and your ledger adds no way to obtain them. Either declare them constants of the checker's version for the life of the process, or name the source of each one.
2. **Say how `main` decides whether to warm up and time.** "For a timed observation the main allocates all buffers, finishes H2D transfers and warms the complete sequence once before recording a start event … The batch check can omit timing." The single generated `main` must learn this from somewhere, for example a field in `cases.bin`, or it must always warm up and time. Otherwise the implementation guesses. The warm-up itself is right: in my probe on the GB10, a kernel's first event interval in a process was 0.115 ms and its second 0.003 ms.

## Cut

1. "flatten the grid over a second block dimension if needed". A one-dimensional grid allows 2³¹−1 blocks, and no corpus size or contract case needs a second dimension.

## Framework and tool changes

- No framework change: correct. Typed transformation ports, `decide` over all missing indices, and `baselineKey`/`subjectKey` replay cover the check, as your probe showed.
- Isolating invocations is the only tool change. With the full-input key kept, two runs collide only if they upload byte-identical directories at the same time, for example two concurrent `checkLowering` calls on one function. It is needed only for that case, and it is minimal and correctly placed. Your test's "distinct program arguments" has no caller in this design.
- No change missed.

## Keep

Keep the restraint: no kernel IR, no framework edits, one tool change. Keep the origin f64 reference with the unchanged stage-1 budget, which the f32 meaning of every corpus program meets with at least 4× margin on the stage-1 cases (my local check). Also keep the warmed timing for each public run and the dropped-tail mutant fed through the checked pass.
