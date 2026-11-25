RISC-V division never traps: it returns -1 for x / 0. The typed language
follows Wasm and traps, so the backend adds the checks. With useRanges
on, safeShare compiles to 56 bytes with no ebreak; off, to 92 bytes with
three.
