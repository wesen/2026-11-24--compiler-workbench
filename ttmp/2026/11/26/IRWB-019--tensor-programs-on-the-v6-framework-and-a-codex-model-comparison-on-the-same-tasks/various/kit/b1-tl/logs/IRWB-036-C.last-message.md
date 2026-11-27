**IRWB-036-C is incomplete.** I committed the design and a reproducible baseline experiment, but did not implement constant-buffer binding, binding-time analysis, or dispatch-loop specialization. Consequently, there is no automatically bytecode-specialized image or gap-closure measurement.

At `n = 12`, `seed = 8`, with `coalesce: true`, the measured RV32 instructions and per-function code sizes were:

| Program | General r0 | General `speed` | Scalar entry binding + `speed` | Hand-written |
| --- | ---: | ---: | ---: | ---: |
| Fibonacci | 7,678 / 840 bytes | 9,286 / 904 bytes | 9,287 / 908 bytes | 75 / 40 bytes |
| Checksum | 6,874 / 840 bytes | 8,218 / 904 bytes | 8,219 / 908 bytes | 74 / 36 bytes |

The scalar experiment closes none of the gap. The listing shows that bytecode loads depend on the loop-carried `pc`; specialization still needs known-state propagation and residual control-flow states. No framework changes were made.

The [ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-tl-irwb-036-c/ttmp/2026/11/27/IRWB-036-C--specialize-the-bytecode-vm-on-its-program/index.md), [design](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-tl-irwb-036-c/ttmp/2026/11/27/IRWB-036-C--specialize-the-bytecode-vm-on-its-program/design-doc/01-constant-buffer-specialization-design.md), and [report](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/b1-tl-irwb-036-c/ttmp/2026/11/27/IRWB-036-C--specialize-the-bytecode-vm-on-its-program/reference/01-final-report.md) record the findings and remaining work.

`npm run build` passed. The requested combined test run was interrupted before completion; the framework tests and several Typed tests, including the VM test, had reported success.

Last commit: `7303f4652b5fc929f7517e7e23fb6f6ac4f04891`.