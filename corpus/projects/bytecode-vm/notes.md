# Bytecode VM

One Typed interpreter runs seeded Fibonacci at entry 0 and a rolling checksum
at entry 34. The corpus uses the fixed 64-cell code image in project.json,
with integer counts from 0 through 12 and seeds from −8 through 8. Local 0
starts at the count, local 1 at the seed, and locals 2 and 3 at zero. Each
fixture reaches HALT with one value on the operand stack.

Each instruction is an opcode and an operand in adjacent u16 cells. Offsets
are absolute cell indices. Unused operands are zero. Arithmetic wraps to
signed i32.

| Opcode | Mnemonic | Effect |
| --- | --- | --- |
| 0 | HALT | Return the top of the stack. |
| 1 | PUSH k | Push the zero-extended u16 operand. |
| 2 | LOAD i | Push local i. |
| 3 | STORE i | Pop into local i. |
| 4 | ADD | Pop right, then left, and push left + right. |
| 5 | SUB | Pop right, then left, and push left − right. |
| 6 | MUL | Pop right, then left, and push left × right. |
| 7 | JZ target | Pop a value and jump if it is zero. |
| 8 | JUMP target | Jump to target. |

## Seeded Fibonacci

Local 2 holds the current value, local 1 the next value, and local 3 their
sum during each update. The fixture executes 15n + 4 instructions including
HALT.

```text
 0  LOAD  0     fib_loop
 2  JZ    30
 4  LOAD  2
 6  LOAD  1
 8  ADD
10  STORE 3
12  LOAD  1
14  STORE 2
16  LOAD  3
18  STORE 1
20  LOAD  0
22  PUSH  1
24  SUB
26  STORE 0
28  JUMP  0
30  LOAD  2     fib_exit
32  HALT
```

## Rolling checksum

Local 1 holds the checksum. Each trip multiplies it by 33 and adds the
current count before decrementing local 0. The fixture executes 13n + 4
instructions including HALT.

```text
34  LOAD  0     checksum_loop
36  JZ    60
38  LOAD  1
40  PUSH  33
42  MUL
44  LOAD  0
46  ADD
48  STORE 1
50  LOAD  0
52  PUSH  1
54  SUB
56  STORE 0
58  JUMP  34
60  LOAD  1     checksum_exit
62  HALT
```

## Explore in the workbench

Open Bytecode VM and select Explore in the Scripts view, or run
`project.run('explore')` in the console. It starts from a fresh r0,
applies the checked `speed` pipeline, and reports the two images' results
and executed RV32 instruction counts. Select the opcode fetch in the
source to inspect the corresponding IR. Compare the dispatch loop with
`p.asmDiff('r0', p.rev, { fn: 'runVm', coalesce: true })`
after applying `p.pipeline('speed')` to the open program.

## Measurements

All three images use the same backend options with `coalesce: true`.
Each value in parentheses is the number of RV32 instructions per guest
instruction. The hand-specialized image uses one Typed loop per fixture,
takes only the two scalars, and runs through the same checked `speed`
pipeline. Its ratios use the original bytecode dispatch count.

| Fixture at n = 12, seed = 8 | Result | Guest instructions | r0 RV32 | speed RV32 | Hand-specialized RV32 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Seeded Fibonacci | 1,152 | 184 | 7,678 (41.73) | 9,286 (50.47) | 75 (0.41) |
| Rolling checksum | 1,298,667,478 | 160 | 6,874 (42.96) | 8,218 (51.36) | 74 (0.46) |

The `speed` revision executed more RV32 instructions for both fixtures in
this comparison. Across the 442 valid calls, the evaluator reached at most
4,131 statements at r0 and 5,350 at `speed` for Fibonacci, and 3,699 at r0
and 4,690 at `speed` for checksum. All finished within the 20,000-statement
pass-check limit.

Reproduce the measurement with
`node --test --test-isolation=none tests/typed/bytecode-vm.test.mjs`
after `npm run build`.
