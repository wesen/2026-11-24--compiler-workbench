---
id: checks
title: Checks: how the workbench knows
part: Part III · Meaning and machines
projects: wrong-shift, ramp, sort, collatz
---
# Checks: how the workbench knows

A pass is allowed to change anything except what the program means. The
workbench does not prove that; it tests it, every time, on generated
inputs, against three baselines.

## 1. The evaluator

`WB.evaluate` interprets the store's statements directly: locals are an
`Int32Array`, memory is a byte array, arithmetic follows the language
(32-bit wrapping, division toward zero, traps on division by zero and
`INT_MIN / -1`, unsigned compares where the IR says so). It counts
statements executed. It is about 60 lines, and it is the definition of
what a revision means.

## 2. Cases

`p.cases(fn)` makes inputs from the function's signature. Integers come
mostly from `[-20, 60]`, then `[-1000, 1000]`, and one case in twenty
from the edges: 0, 1, -1, the largest and smallest `i32`, 65535, 65536.
Buffers get a random length up to 40 and random cells; strings,
printable text; records, small fields. A project can narrow any of it in
its project.json: Blend asks for 40-cell buffers and `n` in `[0, 40]`.
Cases are deterministic in a seed, so a counterexample can be run again.

## 3. Three baselines

```js
const p = wb.projects.open('ramp').program;
p.pipeline('O2');
return {
  againstR0: p.check({ count: 200 }).status, // the evaluator on r0
  // the emulator on our machine code
  againstImage: p.check({ against: 'image' }).status,
  // the emulator on the repo compiler's code
  againstReference: p.check({ against: 'reference' }).status,
};
```

- **r0**: the same source, freshly lifted, on the evaluator. This is
  what checks after each pass use.
- **image**: our RV32 image on the emulator. This checks the backend.
- **reference**: the image the repo's own compiler made from the same
  source when the project was built, on the same emulator. This checks
  the front half of the workbench, our lifting and evaluator, against an
  independent implementation.

A check compares the result, whether each side trapped, and the memory
afterwards, so a wrong store fails it even when the result is right
([Stores into a buffer](project:ramp) is the project that relies on
this). Across all 44 projects, 70 functions, 100 cases each: our
evaluator at r0 agrees with the reference compiler's images on all 6986
decided cases, and our O2 images agree with the evaluator on all 6986.
The other 14 cases hit the step limit.

## 4. The step limit

A loop to `n` with `n = 2147483647` would run for minutes. The first
version of the checks allowed two million statements per case: a full
pipeline run with checks over three small test programs took 60 seconds,
almost all of it in one loop to `n` on edge-case values of `n`. Now each
case may run 20,000 statements on the evaluator and 200,000 instructions
on the emulator; a case that hits the limit on either side is
**inconclusive**, reported as such and left out of the verdict. The same
run takes 1.5 seconds. Data-dependent loops such as
[Collatz](project:collatz) are bounded in the source for the same
reason.

## 5. What checks found while this was built

Each of these was a real bug in the workbench, found by a check, in the
order they appeared:

| what was wrong | caught by | the evidence |
|---|---|---|
| lvn rewrote its own new statement into `vn = vn` | check against r0 after lvn | `halves` 61/150, `halves(…, 37)`: expected 625, got 18 |
| the deliberately wrong div-to-shift | check against r0 | `eighth(-100)`: expected -12, got -13 |
| a backend peephole dropped the function exit when a jump target sat just before it | check of the image against the evaluator | `clamp(26, 23, 720)`: expected 26, got a trap |

The third is worth a sentence. A peephole removed the exit sequence of a
function when the instruction before it was a `ret` or a `jump`, to save
the bytes of a `ret` no one reached. It forgot that a label between them
meant some other block jumped there and fell into the exit. 99 of 120
cases still agreed. It is now one line: the instruction immediately
before the exit label must be the terminal, with no label in between.

Bugs that make a pass do less (two in bce, one in the solver's widening)
are not caught by checks, because doing less is never wrong. Those were
caught by the projects' notes, which state what should happen, and the
Timeline, which shows whether it did.

> **Try it.** Run [A pass that is wrong for
> negatives](project:wrong-shift), then click the first counterexample's
> arguments into the Run view and run both engines.

[The backend](chapter:backend) is next: how statements become
instructions.
