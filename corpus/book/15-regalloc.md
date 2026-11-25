---
id: regalloc
title: Registers, calls and frames
part: Part III · Meaning and machines
projects: pressure, calls, call-chain, across-calls
---
# Registers, calls and frames

Instruction selection produces code on unlimited virtual registers. The allocator maps them onto RV32's: `t0` to `t4` and, in leaf functions, `a0` to `a7` (caller-saved: a call may destroy them), and `s1` to `s11` (callee-saved: a function that uses one must restore it). `t5` and `t6` are kept back as scratch for spills; `s0`, `sp`, `ra`, `gp` and `tp` are never allocated.

## 1. Intervals

`p.machine(fn)` shows the stages. Liveness is computed again, on the machine code: per block, then per instruction. Each virtual register gets one interval, from its first definition or use to its last, stretched over whole blocks where it is live in or out. On Blend after O2 there are 17 virtual registers; the parameters' intervals start at the copies out of `a0` to `a3`, and `s`, `i` and `inv` live from the preheader to the end of the loop.

```svg
<svg viewBox="0 0 680 170" xmlns="http://www.w3.org/2000/svg">
  <g stroke-width="6" fill="none">
    <path d="M60 30 H640" class="ink"/><path d="M60 50 H640" class="ink"/>
    <path d="M90 70 H200" class="mut"/><path d="M110 90 H200" class="mut"/>
    <path d="M170 110 H640" class="ink"/><path d="M190 130 H640" class="ink"/>
    <path d="M380 150 H520" class="acc"/>
  </g>
  <g font-size="10">
    <text x="10" y="34">work</text><text x="10" y="54">n</text><text x="10" y="74">a</text><text x="10" y="94">b</text>
    <text x="10" y="114">s</text><text x="10" y="134">i</text><text x="10" y="154">temps</text>
    <text x="645" y="34" class="mut">a0</text><text x="645" y="54" class="mut">a1</text><text x="205" y="74" class="mut">a2</text><text x="205" y="94" class="mut">a3</text>
    <text x="645" y="114" class="mut">t0</text><text x="645" y="134" class="mut">t1</text><text x="525" y="154" class="mut">t3, t4</text>
  </g>
</svg>
```
Figure: Intervals of Blend's virtual registers after O2 (schematic), with the register each got. `a` and `b` die once `a * b + 64` is computed in the preheader, so their registers are free for the loop.

## 2. Linear scan

Intervals are visited by start. Each takes a free register that does not clash, preferring a hint (a parameter prefers its own `a` register, a returned value prefers `a0`). If none is free, the interval that ends last among the current one and the active ones is spilled to a stack slot. A spilled value is loaded into `t5` or `t6` before each use and stored after each definition.

[Register pressure](project:pressure) has sixteen intermediate values. After O1:

| registers allowed | spills | bytes |
|---|---|---|
| 1 | 18 | 340 |
| 4 | 10 | 252 |
| 8 | 6 | 204 |
| 12 | 2 | 152 |
| 14 or more | 0 | 112 |

The check against the evaluator agrees at every setting. It did not always: a copy whose source and destination were both spilled was dropped as a no-op together with the store of its destination, so `let j = i` in [Insertion sort](project:sort) never reached `j`'s stack slot and the sort returned 0 with four registers or fewer. Sweeping the register count across every project, with a check at each setting, found it; [Register lab](project:regalloc-lab) does that sweep for one project as a task. Blend after O2 does not spill with 8 registers; with 4 it spills 3 values, and with 2 it spills 5 and runs 867 instructions instead of 451.

Three options change how the allocator decides, and the RV32 view's **Backend options** sets them for every image it makes. `order: 'callee'` tries `s1` to `s11` before the caller-saved registers: in `energy` (next section) that saves six registers instead of five and the image grows from 212 bytes to 252, because every `s` register used is saved and restored. `spill: 'current'` always spills the interval that found no register instead of the one that ends last: with 6 registers, Register pressure spills 9 values instead of 8. `hints: false` stops parameters preferring their own `a` register, which brings copies back: 212 bytes become 220. The **Allocation** mode draws every interval with the register it got, the calls as vertical lines, and the selected code under it, so you can see why a value went where it did.

## 3. Calls

An interval that spans a call must be in a callee-saved register, or spilled. In [Helpers and the calling convention](project:calls), `energy` keeps `a`, `b` and `c` across four calls; they get `s1` to `s3`, two more values get `s4` and `s5`, and the frame saves `ra` and those five: 32 bytes. In [A chain of calls](project:call-chain), `h` is a leaf with no frame at all, while `g` and `f` each save `ra`, `s1` and `s2` in 16 bytes.

The allocator does not need to be trusted on this: the emulator checks at every return that `s0` to `s11` and `sp` hold what they held at the call, and faults if not.

## 4. Spills across calls

[Values that live across calls](project:across-calls) keeps up to seven values across four calls. After O2:

| registers allowed | spills | bytes |
|---|---|---|
| 1 | 9 | 240 |
| 8 | 4 | 216 |
| 10 | 2 | 208 |
| 12 or more | 0 | 200 |

`keep` is not a leaf, so its pool is `t0` to `t4` and then `s1` to `s11`, and only the `s` registers can hold a value across a call. With 12 registers it gets `s1` to `s7`, enough for every value that crosses a call; with 10 it gets `s1` to `s5`, and two values go to the stack.

> **Exercise.** The first function of [First steps](project:first-steps) is fine; `twice` is not: it copies `x` from `a0` to `t0` and back before each call. Add move coalescing (or a hint from a call's argument register) and measure the bytes it saves.

The next chapter is about [projects and the tiles they build](chapter:projects), and the last about [the agent](chapter:agent) and reading this workbench's own source.
