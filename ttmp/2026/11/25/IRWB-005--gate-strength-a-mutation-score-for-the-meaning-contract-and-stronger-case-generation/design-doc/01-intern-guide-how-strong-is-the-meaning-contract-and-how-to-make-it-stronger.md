---
Title: 'Intern guide: how strong is the meaning contract, and how to make it stronger'
Ticket: IRWB-005
Status: active
Topics:
    - compiler
    - ir
    - verification
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://src/framework/contracts/differential.ts
      Note: 'runDifferential: agree, disagree, inconclusive, and the no-decided-case rule'
    - Path: repo://src/framework/passes/define-pass.ts
      Note: applyPass, the stages every pass and every mutant goes through
    - Path: repo://src/typed/evaluate.ts
      Note: 'casesFrom, agrees, meaningKept: the default contract the guide explains (frozen)'
    - Path: repo://src/typed/program.ts
      Note: Program.apply (40 cases) and Program.check (100 cases)
ExternalSources: []
Summary: 'Explains, from the code, how every optimization in the IR Workbench is accepted or rejected by a sampled meaning check, and designs two pieces of work: a mutation harness that measures how many wrong programs that check lets through (with equivalent mutants identified rather than counted as failures), and an opt-in stronger case generator whose gain and cost are measured against it.'
LastUpdated: 2026-11-25T23:40:00-05:00
WhatFor: Onboarding for IRWB-005 (items D2a, D2b and C5 of the IRWB-002 agenda) and the reference for its harness and generator.
WhenToUse: Before changing case generation, adding a pass that generates many candidates, or trusting a gate verdict on a new kind of transformation.
---

# Intern guide: how strong is the meaning contract, and how to make it stronger

Every optimization in this compiler is accepted or rejected by one check: the optimized program is run on a few dozen generated inputs per function and compared with the original. If every comparison agrees, the new program is published. This guide is about the strength of that check. It explains, from the code, what the check does and where its blind spots come from, and then it designs the two pieces of work in milestone IRWB-005:

1. a **mutation harness** that manufactures deliberately wrong programs, runs each through the same check, and reports the fraction the check rejects, per project, per function and per kind of fault; and
2. a **stronger case generator**, opt-in, that adds boundary values, special values and the program's own constants to the generated inputs, together with a measurement of how many more wrong programs it rejects and what that costs in time.

Part 1 explains the system the check protects and the check itself. Read it in order; each section uses the terms of the previous ones. Part 2 explains mutation testing and designs the harness. Part 3 designs the stronger generator. Part 4 is the implementation plan, the validation that must stay green, and the risks.

Three conventions hold throughout.

- **Paths are relative to the repository root.** A number after a colon is a line number at commit `7ebb118` (the start of this milestone). Line numbers drift; the symbol next to them does not.
- **Part 1 describes code that exists.** Parts 2 and 3 describe code this milestone adds; such interfaces are marked **New**. If Part 1 and the code disagree, the code is right.
- **Numbers are measurements.** Each comes from a test, a tool under `tools/`, or a script in this ticket's `scripts/` with its output in `various/`.

# Part 1: The check and what it protects

## 1. The problem in one example

Blend is the running example of the whole project (`corpus/projects/blend/main.typed`). After the standard pipeline O2 its main loop reads:

```text
bb:blend.1  -> [.2, .3]
    s:blend.4    if (i >= n) goto .2 else .3
bb:blend.3  -> [.4, .7]
    s:blend.5    t7 = i
    s:blend.6    if (t7 >=u load32[work+0]) goto .4 else .7      <- the bounds check of charCodeAt
bb:blend.4  -> []
    s:blend.7    trap
bb:blend.7  -> [.1]
    s:blend.10   s = (s + (load16[(work + (t7 << 1))+4] * inv))
    s:blend.11   i = (i + 1)
    s:blend.12   goto .1
```

Statement `s:blend.6` is a bounds check: if the index `t7` is not below the buffer's length (the word at `work+0`), the program traps. Suppose a bounds-check elimination pass had a bug and removed this check where it should not have. The program would then read past the end of the buffer instead of trapping. That program is wrong.

The gate accepts it. Script `03-probe-blend-mutants.mjs` of this ticket builds exactly that program, as a pass, and applies it the way every pass is applied:

```text
drop-check  {"pass":"mutant","rev":"r7","changed":true,"check":"40/40"}        accepted
   4000 cases under Blend's input specification:  agree 4000, disagree 0
   4000 cases with no input specification:        agree 3869, disagree 131
      first counterexample: args [1024, 26, -16, 518]: expected trap, got -2855784
```

The reason is in Blend's `project.json`: its inputs are a buffer of exactly 40 cells and `n` in [0, 40]. With those inputs the index never reaches 40, so the check never fires, and removing it changes nothing *on the inputs the project declares*. On other inputs it does. The counterexample's arguments are the buffer's address (1024), `n = 26`, `a = −16` and `b = 518`; its buffer, generated without a specification, is shorter than 26 cells. The original program traps at the first index past the end; the mutant reads on into memory that is not part of the buffer and returns a number.

This one example contains the three questions this milestone answers with numbers:

- How often does the gate accept a wrong program? (Here: on the inputs it samples, this program is not wrong at all.)
- When it accepts one, is that a weakness of the *sampling* (more or better cases would have caught it), or of the *specification* (no input the project allows can show the difference), or is the program not wrong at all?
- What would it cost to catch more?

## 2. Passes and revisions

The compiler represents a program as an immutable **artifact** of the IR `typed.blocks`: a control-flow graph of blocks, each a list of statements, each statement holding expression trees of **values**. An artifact's **revision** is a SHA-256 hash of its content, so two artifacts with the same content have the same revision whoever made them. A program's history is a list of artifacts r0, r1, …, rN kept by the class `Program` (`src/typed/program.ts:80`). r0 is the program as lifted from the front end; each pass application that changes the program appends one revision.

A **pass** turns one revision into the next. The Typed passes are written with `typedPass` (`src/typed/passes.ts:165`):

```ts
export const strength = typedPass({
  name: 'strength',
  about: 'x / 2^k and x % 2^k become shifts and masks when ranges prove x is not negative',
  needs: { ranges: 'ranges' },      // analyses the body reads
  writes: ['values'],               // what it may change: values | stmts | locals | cfg
  preserves: ['cfg', 'dominators', 'loops'],
  body({ f, tx, facts }) { /* one call per function; every edit goes through tx */ },
});
```

The body never edits tables directly. It goes through a **transaction** `Tx` (`src/typed/tx.ts:165`), whose methods create values (`tx.const`, `tx.make`), rewrite value trees (`tx.rewrite`, :431), and place, move, replace or remove statements (`tx.insert`, `tx.move` :370, `tx.replaceStmt` :399, `tx.remove` :351). Every created entity records an origin (made from what, by which pass, because of which fact). `typedPass` runs the body once per function on a mutable working copy (`Store.from(before.value)`) and returns the new native value.

The framework applies a pass with `applyPass` (`src/framework/passes/define-pass.ts:190`). Nothing is published unless every stage succeeds:

```text
applyPass(pass, before, { manager, contract, contractInputs: { origin: r0 } }):
  facts   <- the analyses the pass needs, computed for `before` (cached per revision)
  native  <- pass.run(...)                                   the body, once per function
  after   <- createIRArtifact(adapter, id, native)           validate the IR, freeze, hash
  changes <- diff(projection(before), projection(after))
  if nothing changed:                         return { changed: false }
  if changes touch kinds outside pass.writes: throw PassError('undeclaredWrite')
  verify the contract on { input: before, origin: r0 } -> { output: after }
      on failure:                             throw PassError('contractRejected')    <- the gate
  check each preservation claim               throw PassError('preserveViolated')
  return { changed: true, artifact: after, ... }
```

`Program.apply` (`src/typed/program.ts:248`) is the entry point everything uses (pipelines, strategies, the browser workbench). It calls `applyPass` with one specific contract:

```ts
optimizationContract({ inputs: this.inputs, count: 40, seed: 7, roots? })   // program.ts:258
```

and pushes the new revision only if `applyPass` returns without throwing. That contract is "the gate" of this guide.

## 3. The meaning contract

A **contract** in this framework is a set of named conditions on a transformation's inputs and outputs, verified by the `AnalysisManager`. `optimizationContract(params)` (`src/typed/passes.ts:221`) has one condition: it *ensures* the invariant `meaningKept(params)` with the origin bound to r0 and the candidate bound to the pass's output. The comparison is always against r0, never against the previous revision, so differences cannot accumulate across passes.

`meaningKept` (`src/typed/evaluate.ts:564`) is an instance of the framework's **differential** invariant (`differential`, `src/framework/contracts/differential.ts:70`). A differential invariant is specified by five functions: generate the cases, run one side on one case, compare two outcomes, say whether an outcome is inconclusive, and describe a case for the evidence. `runDifferential` (`differential.ts:102`) executes it:

```text
runDifferential(spec, { origin, candidate }):
  cases <- spec.cases(...)                       for meaningKept: casesFrom per function, below
  for each case c:
      a <- spec.run('baseline', origin, c)       evaluate r0 on c
      b <- spec.run('subject', candidate, c)     evaluate the candidate on c
      if inconclusive(a) or inconclusive(b):  inconclusive++ ; continue      (differential.ts:116)
      if compare(a, b, c):  agree++  else  disagree++, keep up to 5 counterexamples
  status <- disagree > 0 ? 'disagree' : agree > 0 ? 'agree' : 'inconclusive'
  the invariant holds iff status = 'agree'
```

Three properties of this procedure matter for everything that follows.

- **A single disagreeing case rejects.** The gate is a conjunction over cases.
- **A case where either side hits the step limit is not a verdict.** It is counted as inconclusive and skipped.
- **A check with no decided case fails.** If every case is inconclusive, nothing was established and the pass is rejected.

`meaningKept`'s parameters are `MeaningParams` (`evaluate.ts:539`): `count` (default 40), `seed` (7), `inputs` (the project's input specifications), `limit` (the step limit, 2e4) and optionally `roots` (only these functions are compared; used for Candela, whose host calls four entry functions). The parameters are hashed into the invariant's version (`1+<hash>`, `evaluate.ts:572–577`), and one definition object exists per parameter set. That version string is the contract's identity: two checks with the same version are the same check.

Two other places run the same comparison outside `applyPass`:

| caller | cases per function | where |
|---|---:|---|
| `Program.apply`, every pass | 40 | `program.ts:248` |
| `Program.check()`, the workbench's Checks view | 100 | `program.ts:593` |
| `tools/parity.mjs`, the final check of each corpus project | 100 | `meaningKept({ count: 100 })` |
| `tools/candela-o2.mjs`, Candela's O2 | 40 per pass, 100 final | every one of the 332 functions; no `roots` |

On Candela the tools compare all 332 functions; only the workbench's Candela project passes the host's four entry functions as `roots`. This guide uses the all-functions form, because it is what the Candela measurements in IRWB-001 report.

## 4. Cases: how inputs are generated

A **case** (`Case`, `evaluate.ts:221`) is one call: a function name, a list of argument values, and an initial memory image holding the buffers and records the arguments point to. `casesFrom(st, fname, { count, seed, inputs })` (`evaluate.ts:230`) generates `count` cases for one function:

```text
casesFrom(st, f, { count, seed, inputs }):
  rnd <- rng(seed)                                   xorshift32, the prototype's generator (evaluate.ts:14)
  edges <- f has an f32 parameter ? min(15, floor(count / 4)) : 0
  for k in 0 .. count-1:
      mem <- new Memory()                            allocations from byte 1024, each rounded up to 16 bytes
      for each parameter i of type t:
          if t = f32 and k < edges and no spec for it:  F32_EDGES[(k + i) mod 15]
          else:                                         makeValue(inputs[name_i], t, mem, rnd)
      case k <- { fn: f, n: k, args, memory: mem.image(), items }
```

`makeValue` (`evaluate.ts:128`) interprets an **input specification**, one per parameter, written in the project's `project.json`:

| specification | meaning | example (project) |
|---|---|---|
| `[lo, hi]` | an i32 uniform in [lo, hi] | `"n": [0, 40]` (blend) |
| a number | that value | |
| `{ "buffer": [a, b], "cell": [c0, c1] }` | a buffer of length uniform in [a, b], cells uniform in [c0, c1] (default [0, 255]) | `"work": { "buffer": [40, 40], "cell": [0, 255] }` (blend) |
| `{ "cells": [...] }`, `{ "string": "..." }` | a fixed buffer | `"s": { "string": "the quick brown fox ..." }` (strings) |
| `{ "record": { field: spec } }` | a record, one word per field | `"p": { "record": { "x": [-100, 100], ... } }` (records) |
| `{ "oneOf": [...] }`, `{ "bool": true }` | one of the values; 0 or 1 | Candela's `scene` |
| `{ "floats": [a, b], "range": [lo, hi] }` | a buffer of f32s | Candela's row buffers |

A parameter without a specification gets a default by type (`evaluate.ts:171–187`):

```text
i32:     72 %  uniform in [-20, 60]
         20 %  uniform in [-1000, 1000]
          5 %  one of 0, 1, -1, 2147483647, -2147483648, 65535, 65536
          3 %  any i32
buffer:  length in [0, 40], cells in [0, 255];   string: length [0, 24], cells [32, 126]
bool, enum, record: uniform over the values / fields with defaults
f32:     55 % in [-4, 4], 20 % in [-1000, 1000], 15 % in [0, 1], 7 % an edge value, 3 % any bits
```

Two properties of the generator are load-bearing.

- **Determinism per function.** `rng(seed)` restarts for every function, so the cases of function `f` depend only on `f`'s signature, its specification and the seed. They do not depend on which other functions the program has. Section 10 uses this.
- **The cases are the book's.** The generator is a port of the prototype's, value for value, so that the corpus reproduces the book's numbers (6,986 decided cases agree, 14 at the step limit). Any change to `casesFrom` or `makeValue` changes those numbers. This is why the stronger generator of Part 3 is a separate function and a separate contract version, and the default is frozen.

The f32 edge sweep (`F32_EDGES`, `evaluate.ts:194`: NaN, ±∞, ±0, ±1, the smallest subnormal, the largest finite value, and others) was added after a measured failure. Four float rewrites that are valid over the reals and wrong for IEEE floats (`x + 0 → x`, `x · 0 → 0`, `x − x → 0`, `!(a < b) → a ≥ b`) were written as deliberately wrong passes; with random inputs, two of them were accepted at 40 cases per function, because a random float is almost never NaN. With the sweep all four are rejected at 40. That experiment is the smallest instance of what Part 2 does systematically.

## 5. The evaluator and its step limit

What a program means is defined by the evaluator, `evaluate(st, fname, args, memBytes, { limit, counts })` (`evaluate.ts:345`), an interpreter for `typed.blocks`. It returns a `RunResult` (`evaluate.ts:314`):

```ts
interface RunResult {
  trap: string | false;                  // why the run trapped, or false
  result?: number | readonly number[];   // an i32 (an f32's bits), or the leaves of a record result
  limit: boolean;                        // stopped by the step limit
  steps: number;                         // statements executed
  bytes: Uint8Array;                     // guest memory afterwards
  counts: Map<string, number> | null;    // per statement, with { counts: true }
  fault?: boolean;                       // only the emulator sets it: a calling-convention violation
}
```

A run **traps** on a division by zero or overflow (`binop`, `evaluate.ts:274–281`), a `caddr` position not below its buffer's capacity (:412), a memory access outside the guest memory image (`check`, :364), a `trap` statement (a failed branch-form bounds check, :471), a call depth above 64, or a stack overflow of the frame area. The guest memory a case runs on is the image `Memory.image()` returns (`evaluate.ts:95`): every byte up to the end of the last allocation, which is rounded up to 16 bytes, and at least 1,024 bytes. Blend's 40-cell buffer starts at byte 1024 and occupies 84 bytes (a 4-byte length and 40 two-byte cells), so its image is 1,120 bytes long. A read of cells 40 to 45 lands in the padding and does *not* trap; a read of cell 46 or beyond does. A read past an earlier buffer lands in the next one. Remember this for the dropped-check and hoisted-load mutants of section 11: whether an out-of-bounds read traps depends on where the buffer happens to lie.

The **step limit** counts executed statements. The gate uses 2e4 (`meaningKept`'s default); `Program.exec` uses 5e6. A run that reaches the limit returns `limit: true` and no result, and the gate counts the case as inconclusive. On the corpus at 100 cases per function, 14 of 7,000 cases hit the limit, all in `my-analysis`; on Candela, 215 of 33,200 do, all in five deep functions.

## 6. Verdicts

`agrees(expected, got)` (`evaluate.ts:531`) decides one case; `expected` is r0's run, `got` the candidate's:

```ts
export function agrees(expected: RunResult, got: RunResult): boolean {
  if (got.fault) return false;                         // a calling-convention violation never agrees
  if (expected.trap) return !!got.trap;                // a trap agrees with any trap, for any reason
  if (got.trap || !sameResult(got.result, expected.result)) return false;
  return sameBytes(got.bytes, expected.bytes);         // over the memory image both runs wrote
}
```

Combined with the inconclusive rule of `runDifferential`, every case ends in one of five verdicts:

| verdict | condition | counts as |
|---|---|---|
| agree | neither side traps; same result, same memory | agreement |
| trap | both sides trap (the reasons may differ) | agreement |
| disagree | one traps and the other does not, or results or memory differ | rejection |
| inconclusive | either side hit the step limit | nothing |
| fault | the emulator detected a calling-convention violation (image checks only) | rejection |

Two consequences for mutation testing follow directly from this table.

- A mutant that only changes *why* a program traps, or *where*, is not wrong under this contract. The contract defines meaning up to the trap reason. That is a deliberate choice (it lets `bcm` move a check earlier), and such mutants are equivalent, not survivors.
- A mutant that makes a loop run forever on some inputs and is correct on the others is accepted: its non-terminating cases are inconclusive. The harness must recognise this and classify it as wrong, because a non-terminating program is wrong when r0 terminates.

## 7. The oracles

An **oracle** is anything that can say what a program should do on an input. The project has three, and they share as little code as possible:

| oracle | what runs | entry point |
|---|---|---|
| the evaluator | `typed.blocks` interpreted | `evaluate` (`src/typed/evaluate.ts:345`) |
| the reference image | the *source*, compiled by the PicoCalc toolchain's own compiler (vendored `typed-rv32.js`), run on the vendored RV32 interpreter | `referenceCompile` (`src/typed/reference.ts:26`), `referenceRun` (:40) |
| our image | a `typed.blocks` revision lowered by this project's backend, run on the same interpreter | `lowerToImage` (`src/typed/backend/compile.ts:429`), `runImage` (`src/typed/backend/run.ts:74`) |

The evaluator is the specification; the other two are checks on it. On the corpus the evaluator at r0 and the reference images agree on every decided case (`tools/reference-check.mjs`); on Candela they agree on 33,200 cases with both reference policies. For this milestone the reference image has a specific use: it is a second, independent answer to "what does the *source* do on this input", so when the harness concludes that a surviving mutant is equivalent to r0, it can confirm that the mutant also agrees with the reference image on the same inputs. A disagreement there would mean the evaluator itself is wrong somewhere. Our image is not needed for classifying mutants of `typed.blocks`; it matters for mutants of machine code, which are out of scope (IRWB-002 item A5).

## 8. What is known about the gate's strength today

Very little, and that is the point of the milestone.

- On the corpus, every pass of every pipeline is accepted, and the final 100-case checks agree on 6,986 decided cases (`tools/parity.mjs`).
- The one deliberately wrong pass in the pass list, `div-to-shift` (`passes.ts:664`), is rejected on its demonstration project.
- Two of four wrong float rewrites were accepted at 40 random cases before the edge sweep existed (section 4).

None of this says how many wrong programs the gate would accept. Passes in the corpus are correct, so a correct pass being accepted is no evidence of strength; the only evidence is wrong programs being rejected, and there have been five of them. IRWB-002 lists the risk this leaves ("Trust in the gate", its section 22): techniques that generate many candidates (rule discovery, equality saturation, search) raise the chance that one wrong candidate slips through. The mutation score is the measurement that risk calls for.

What to carry into Part 2:

- The gate is `applyPass` with `optimizationContract`: 40 generated cases per function, seed 7, step limit 2e4, every function compared with r0.
- One disagreeing case rejects; a case at the step limit decides nothing; a check with no decided case rejects.
- Traps agree with traps whatever their reason; memory is compared over the image both runs wrote.
- Cases are generated per function from the project's specification and the seed, and the default generator is frozen because the book's numbers depend on it.
- The evaluator defines meaning; the reference image is an independent check on it.

# Part 2: Measuring the gate with mutants

## 9. Mutation testing

**Mutation testing** measures a test suite by injecting faults. A **mutant** is the program with one small, deliberate change, made by a **mutation operator** at one **site** (one value or statement). The suite **kills** a mutant if it fails on it, and the mutant **survives** if the suite passes. The **mutation score**, or **kill rate**, is the fraction of mutants killed.

Here the suite is the gate, a mutant is a revision, and killing means `applyPass` throws `contractRejected`. The standard difficulty of mutation testing applies unchanged: some mutants are not wrong. A mutant that computes the same function as the original on every input is an **equivalent mutant**. No check can kill it, and counting it as a survivor would blame the gate for a property of the mutant. The kill rate must therefore be computed over non-equivalent mutants:

```text
kill rate = killed / (killed + surviving non-equivalent mutants)
```

and every survivor has to be classified. Deciding equivalence in general is undecidable, so the classification is a procedure with several outcomes, some of them proofs and some of them evidence (section 12).

In this project, equivalence has to be defined relative to the contract, and the contract has an input domain: the project's input specifications. That gives two notions, and Blend's dropped check from section 1 separates them:

- A mutant is **equivalent** if it agrees with r0 on every input, under the verdict rules of section 6.
- A mutant is **equivalent under the specification** if it agrees with r0 on every input the specification allows, but not on every input.

Both are excluded from the kill rate, because the gate is defined only on the specified domain: the project has declared that other inputs do not occur, and a gate cannot be faulted for not sampling what was declared impossible. The second kind is reported separately all the same. A pass that produced such a mutant would be relying on the specification as an assumption, exactly as specialization does through `Program.assume`. That is legitimate when it is deliberate and dangerous when it is accidental, and the report should show how often the specification, rather than the sampling, is what hides a change.

## 10. Mutants as revisions

The brief for this milestone requires that mutants be judged "exactly as the gate judges a pass". The simplest way to guarantee that is to make each mutant a pass. A single **New** pass, `typed.mutant`, takes one site as its parameter and applies that one mutation through the transaction:

```ts
// New: src/typed/mutate.ts
export const mutantPass = typedPass({
  name: 'mutant',
  about: 'applies one mutation (params.site) to one function: a deliberately wrong revision',
  writes: ['values', 'stmts', 'locals', 'cfg'],
  body({ st, f, tx, facts, params }) {
    const site = params.site as MutationSite;
    if (f.name === site.fn) applyMutation(st, f, tx, site);
  },
});

// judging one mutant with the gate every pass meets:
await program.apply(mutantPass, { params: { site } });   // throws contractRejected = killed
program.undo();                                          // when it was accepted
```

The mutant then passes through every stage of section 2: its IR is validated, frozen and hashed; its changes are diffed and checked against its declared writes; the contract runs with `origin: r0`; and only then is it accepted or rejected. A mutant that produces invalid IR is caught by validation, not by the meaning check, and is reported separately as *invalid* (the operators are written so that this does not happen; the count should be zero).

Two further gate configurations are measured on the same mutant artifact:

- **check-100**: `meaningKept({ inputs, count: 100, seed: 7 })` run through `manager.checkInvariant`, the configuration of `Program.check` and `tools/parity.mjs`.
- **strong**: the contract of Part 3.

These do not go through `applyPass`, but they evaluate the same invariant definitions on the same `{ origin, candidate }` ports, and an invariant's verdict is a function of its definition and its inputs only. A test checks, on a sample of mutants, that `checkInvariant` with the default parameters gives the same verdict as `Program.apply`. (`Program.check` generates its cases from the head's signatures rather than r0's; no operator changes a signature, so its cases are the same.)

**Every gate is first run on the base.** A mutant can only be "killed" by a gate that accepts the unmutated base; otherwise that gate would reject every mutant of the project for a reason that has nothing to do with the mutation. The default gate accepts the base by construction (the pipeline went through it). The other configurations are run on the base once per project, and a project whose base one of them rejects is reported, with the counterexample, and left out of that configuration's comparison. Such a rejection would itself be a finding: a pipeline result the default gate accepted and a stronger one did not.

**Which revision is mutated.** A bug in a pass shows up in that pass's output and everything after it, and the gate compares that output with r0. The harness therefore mutates a *base* revision that the gate has already accepted, and the default base is the head after the project's own pipeline (usually O2). Operators that model a specific pass need that pass's output: a wrong shift amount in strength reduction can only be injected where `strength` or `simplify` produced a shift. A second base, r0 itself, is available as an option; it has sites that O2 removes (bounds checks `bce` deleted, constants `fold` folded).

**An exact shortcut for large programs.** On Candela, running the whole gate for every mutant is too expensive (13,280 cases per check). The verdict can be computed exactly from fewer runs. Let f be the mutated function and A the set of functions that reach f through calls, f included. For a function g outside A, the mutant's run of g on any case executes only code that is identical in the base, so its outcome equals the base's. The base was accepted by the same gate, so all of g's cases agreed or were inconclusive. Therefore:

```text
evidence(mutant)  =  evidence(mutant, cases of A)  +  evidence(base, cases of F \ A)
rejected(mutant) <=> disagree(mutant, A) > 0
                     or  agree(mutant, A) + agree(base, F \ A) = 0        (no decided case at all)
```

The base's evidence per function is computed once. Each mutant then costs only the cases of A, and the verdict is the one the full gate would give. Because cases are generated per function from the seed (section 4), the cases of A are exactly the cases the full gate would run for them.

## 11. The mutation operators

Each operator models a bug a real pass of this compiler could have. The table lists what the operator changes, which pass it models, and its variants per site. All operators act on one site in one function and leave the rest of the revision unchanged.

| operator | change | models | variants per site |
|---|---|---|---|
| `const` | an i32 constant `c` becomes `c + 1` or `c − 1` | `fold`, `constprop` computing a wrong constant | 2 |
| `cmp-flip` | a comparison becomes its negation: `eq↔ne`, `lt↔ge`, `gt↔le`, `ltu↔geu` | `simplify`'s `!(a < b) → a ≥ b` applied to the wrong operator | 1 |
| `cmp-weaken` | strict ↔ non-strict (`lt↔le`, `gt↔ge`), or signed ↔ unsigned (`lt↔ltu`, `ge↔geu`) | an off-by-one loop bound; a check that forgets negative indices | 1–2 |
| `swap` | the operands of a non-commutative operator exchanged (`sub div rem shl shr shru lt gt le ge ltu geu`) | a rewrite rule with its sides confused | 1 |
| `shift` | a constant shift amount `k` becomes `k ± 1`; `shr ↔ shru` | `strength`'s `x / 2^k → x >> k` with the wrong `k`, or with a logical shift | 2–3 |
| `drop-check` | a branch-form bounds check (`br_if` whose arm is a `trap` block) becomes a jump to the other arm; a `caddr(r, p)` becomes the unchecked `r + (p << 1)` | `bce` removing a check it had not proved | 1 |
| `check-range` | a check is weakened by exactly one position: `i >=u len` becomes `i >=u len + 1`; `caddr(r, p)` checks `p ≤ cap` instead of `p < cap` | `bcm` merging a group with a wrong range | 1 |
| `hoist-trap` | a statement whose value can trap (division, load, checked address) moves from a block into its only predecessor, before that block's conditional branch | `licm` hoisting an impure expression; speculation past a guard | 1 |
| `f32` | `fadd↔fsub`, `fmul↔fdiv`, `fmin↔fmax`, `flt↔fle`, `fgt↔fge`, `feq↔fne`, `ffloor↔fceil`, `ftrunc→ffloor`, `f2i↔f2u`, `i2f↔u2f`; an f32 constant's bits ±1 ulp or its sign flipped | a float rule or a folded constant that is wrong in the last bit or the sign of zero | 1–3 |
| `drop-store` | a `store` statement removed | `dce` treating a store as dead | 1 |

Some details of the operators are worth stating because they decide what the numbers mean.

- **No operator duplicates another.** `const` skips shift amounts, which belong to `shift`. `swap` skips sites whose two operands are the same tree, because swapping them changes nothing.
- **`check-range` on `caddr` needs care.** The obvious form, `caddr(r, p − 1) + 2`, traps wrongly when `p = 0` (because `−1` is the largest unsigned number). The operator instead computes `d = (p ≠ 0)` and builds `caddr(r, p − d) + 2d`: for `p = 0` this checks position 0 as before, and for `p ≥ 1` it checks `p − 1 < cap`, which is `p ≤ cap`. The address is unchanged in both cases. Because `p` is used twice, the operator copies its tree and applies only when `p` is pure.
- **`hoist-trap` isolates the speculation.** Moving a statement `s` from block B to the end of B's only predecessor P must not change anything except that `s` now also runs when P branches elsewhere. The operator therefore requires: no earlier statement of B writes a local `s` reads, or reads or writes the local `s` writes; no earlier statement of B is a store when `s` reads memory; P's branch condition does not read the local `s` writes; and that local is not live at the start of P's other successor. Under these conditions the only possible difference is a trap on the other path. Such a mutant is often equivalent here, because a load a few bytes past a buffer stays inside the 4 KiB guest memory and does not trap (section 5). The classification will say how often.
- **`drop-check` and `check-range` produce mostly specification-equivalent mutants when the specification never reaches the bound.** Blend is the example. This is a property of the projects' specifications, and the report gives the count.

Operators that need sites the corpus does not have are measured elsewhere: the corpus is i32 only and has no `caddr` (its bounds checks are branches), so `f32` and the `caddr` forms of `drop-check` and `check-range` are measured on the f32 fixture of `tests/typed/f32-fixture.mjs` (31 small f32 functions) and on a subset of Candela.

## 12. Classifying survivors

A mutant the gate rejects is wrong: there is an input in the specified domain on which it disagrees with r0. (The one exception, rejection because every case was inconclusive, is recorded as its own kind of kill.) A mutant the gate accepts may be wrong or equivalent, and the harness runs a cascade of increasingly expensive methods on it. The first methods search for a witness, an input on which the mutant is wrong; a mutant with no witness passes to the next method; the last methods produce evidence, or for small domains a proof, that it is equivalent.

```text
classify(mutant M, base, r0, spec):
  A <- functions reaching the mutated function, itself included
  1. exhaustive:   if the functions in A have finite specified domains of at most 300,000 inputs in total:
                       run r0 and M on every input (limit 2e5)
                       a disagreement            -> wrong (killable)            witness: that input
                       none                      -> equivalent under the spec   (proved on the domain)
  2. large sample: 4,000 specified cases per function of A (seeds 101, 102, ...), and the strong generator's
                   boundary cases, limit 2e5
                       a disagreement            -> wrong (killable)
                       M at the limit 2e5 on an input where r0 finished within the gate's 2e4  -> wrong (diverges)
  3. unconstrained: 4,000 cases per function with no specification (the default distributions)
                       a disagreement            -> equivalent under the spec only (spec-masked)
                       none                      -> presumed equivalent
  4. reference:    run the reference image on the cases of 2; it must agree with M wherever r0 does
                       otherwise                 -> flag: the evaluator and the reference differ
  5. inspection:   presumed-equivalent mutants are grouped by operator and by reason, and each group is
                   argued by reading the code (for example: "the moved load stays inside guest memory")
```

Equivalence is a property of the mutant; being killed is a property of the mutant *and a gate*. The classification is therefore done once per mutant (on every mutant that at least one gate accepts), and for each gate a mutant counts as killed if that gate rejects it and otherwise by its class. The classes, from one gate's point of view:

| class | meaning | in the kill rate |
|---|---|---|
| `killed` | rejected by the gate | numerator and denominator |
| `killed-inconclusive` | rejected because no case was decided | numerator and denominator, reported apart |
| `survived-wrong` | accepted, but a specified input shows it wrong (exhaustive, sample, or divergence) | denominator only: a real miss |
| `equivalent-spec-proved` | accepted; exhaustively equal on the specified domain | excluded |
| `equivalent-spec` | accepted; no specified difference found, an unspecified one found | excluded, reported |
| `equivalent-presumed` | accepted; no difference found anywhere | excluded in the upper bound, counted as a miss in the lower bound |
| `invalid` | the mutant is not valid IR | excluded, should be zero |

Because `equivalent-presumed` is evidence and not proof, the report gives the kill rate as an interval:

```text
upper = killed / (killed + survived-wrong)
lower = killed / (killed + survived-wrong + equivalent-presumed)
```

and the inspection of step 5 is what justifies reading the upper bound.

Exhaustive domains exist in more of the corpus than one might expect, because many specifications are small ranges: `collatz` (`n` in [1, 2000]: 2,000 inputs), `wrong-shift` (`s` in [−100, 100]: 201), `licm-traps` (6 × 101 × 7 = 4,242), `gcd` (251² = 63,001), `strings` (one fixed string: 1). A domain is finite when every parameter of every function in A is a range, a fixed value, a `oneOf`, a bool, an enum, a record of finite fields, or a fixed buffer. Variable buffers and unspecified integers make it infinite for this purpose.

## 13. The harness

The harness has a library part and a tool part.

**`src/typed/mutate.ts`** (**New**) holds the operators and the mutant pass:

```ts
export type MutationOperator =
  'const' | 'cmp-flip' | 'cmp-weaken' | 'swap' | 'shift' | 'drop-check' | 'check-range' | 'hoist-trap' | 'f32' | 'drop-store';
export interface MutationSite {
  readonly operator: MutationOperator;
  readonly fn: string;          // the function mutated
  readonly target: string;      // the value or statement id in the base revision
  readonly variant: string;     // e.g. '+1', 'le', 'shru', 'flip-sign'
  readonly text: string;        // the site as listed, for reports
}
export function mutationSites(st: Store, options?: { fns?: string[]; operators?: MutationOperator[];
                                                      live?: (fn: string) => LiveView }): MutationSite[];
export function applyMutation(st: Store, f: WorkFn, tx: Tx, site: MutationSite): void;
export const mutantPass: TypedPass;
export function callersOf(st: Store, fn: string): string[];            // the set A of section 10
export function finiteDomain(st: Store, fn: string, inputs: FunctionInputs, budget: number): Case[] | null;
```

Sites are enumerated in a fixed order (function order, block order, statement order, value trees in pre-order), so a site list and every number derived from it are reproducible.

The pieces fit together as follows; every arrow labelled with a gate is a run of `meaningKept` (or the strong variant) against r0.

```text
   r0 ── project pipeline (O2), gated ──► base ──── mutationSites(base) ───► site 1, site 2, ... site n
                                           │                                     │
                                           │                 mutantPass(site) through applyPass
                                           │                                     ▼
                                           │                            mutant revision M
                                           │                  ┌──────────────────┼───────────────────┐
                                           │           default gate        check-100           strong gate
                                           │           (Program.apply)    (checkInvariant)    (checkInvariant)
                                           │                  └──────────────────┼───────────────────┘
                                           │                      all reject?    │   some accept
                                           │                          killed     ▼
                                           │                              classify(M): exhaustive →
                                           │                              large sample → unconstrained →
                                           └── base verdict per gate ───► reference → inspection
                                                                                  │
                                              one JSON record per mutant ◄────────┘
                                              tables per project, function, operator
```

**`tools/mutation-score.mjs`** (**New**) drives it:

```text
for each project (or the f32 fixture, or the Candela subset):
    p <- Program.fromProject(...);  run its pipeline                    the base (or r0 with --base origin)
    sites <- mutationSites(base)
    for each site:
        default <- try p.apply(mutantPass, { params: { site } }) ; undo      killed | survived | invalid
        M <- the mutant artifact
        check100 <- checkInvariant(meaningKept({ inputs, count: 100 }), { origin: r0, candidate: M })
        strong   <- checkInvariant(meaningKeptStrong({ inputs, ... }), ...)
        if any gate accepted M:  class <- classify(M)                  section 12
        write one JSON line per mutant
aggregate per project, per function, per operator; print tables at tile width; write various/<run>.json
```

Each per-mutant record holds the site, the base revision, the mutant's revision hash, each gate's verdict and evidence counts, the class, the witness input if there is one, and the time each gate took. The aggregate tables are what the report quotes.

# Part 3: Making the gate stronger

## 14. A stronger case generator

The survivors of Part 2 say what kind of input the default generator misses. The design here is fixed in advance from the known weaknesses, and then measured against the mutants:

- **Boundaries of the specification.** A range `[lo, hi]` contributes `lo`, `lo + 1`, `hi − 1`, `hi`, and 0, ±1 when they lie inside it. A buffer `{ buffer: [a, b] }` contributes the lengths `a`, `a + 1`, `b − 1`, `b`, and its cells the patterns "all `c0`", "all `c1`", ascending and descending ramps.
- **Special values of the type.** For an unspecified i32: 0, ±1, ±2, the extremes and their neighbours, and powers of two with their neighbours (2^k, 2^k − 1, −2^k). For an f32: `F32_EDGES` and further patterns (negative NaN, a signalling NaN, the largest subnormal, the neighbours of 1, the rounding boundary 2^23, the halfway values 0.5, 1.5, 2.5).
- **The program's own constants.** Every i32 constant `c` that occurs in the function at r0 contributes `c − 1`, `c`, `c + 1` to the pools of its integer parameters and its buffer lengths, clipped to the specification. A comparison `i < 40` in the code makes 39, 40 and 41 likely inputs.
- **Coverage-guided selection (optional).** Generate a larger pool, run it on r0 with `counts`, and keep cases that execute a statement no earlier case executed, until the budget is spent.

The generator **appends** these cases to the default ones:

```text
strongCasesFrom(st, f, { count, extra, seed, inputs }):
  base  <- casesFrom(st, f, { count, seed, inputs })          the default cases, unchanged, first
  pools <- for each parameter: boundary ∪ special ∪ constants, clipped to its specification
  for j in 0 .. extra-1:
      each parameter i takes pools_i[(j + 3 i) mod |pools_i|]     each pool value occurs at least once
                                                                  when extra >= |pools_i|
  return base ++ the `extra` boundary cases
```

Appending, instead of replacing, makes the strong contract stronger by construction: every input the default gate runs, it also runs, so it kills every mutant the default kills. It also makes the cost easy to state, as `(count + extra) / count` times the default's evaluations. To separate "more cases" from "better cases", the measurement compares the strong contract with `count + extra` cases against the default with the same number of cases.

**The contract version.** The strong check is a new differential invariant, `meaningKeptStrong(params)` in **New** `src/typed/cases-strong.ts`. It has the same id, `typed.meaning-kept`, and the same verdict rules, but version `2+<hash>`, where the hash covers `{ generator: 'strong-1', count, extra, seed, inputs, limit, roots }`. A matching `strongOptimizationContract(params)` wraps it as `typed.optimization@2+<hash>`. Nothing in the existing code calls either; a caller opts in by passing the contract to `applyPass`. The default `meaningKept`, its key, its version string and every decision it makes stay exactly as they are, and a test pins the default version string.

## 15. Measuring gain and cost

The gain is the kill rate on the mutants of Part 2 under each configuration:

| configuration | cases per function |
|---|---:|
| default (`Program.apply`) | 40 |
| default, 80 cases | 80 |
| check (`Program.check`) | 100 |
| strong (40 default + 40 boundary) | 80 |
| strong, coverage-guided (optional) | 80 |

The cost is measured two ways: the gate's time per mutant in the harness, and the time of a full O2 run over the corpus with each contract (`tools/mutation-score.mjs --cost`). A third measure is coverage: the share of r0's blocks executed by each case set, per project.

If the strong generator should become the default, that is a recommendation for the report with these numbers behind it, not a change this milestone makes.

## 16. Testing the facts themselves (C5, optional)

The passes act on facts: `strength` and `bce` on the intervals of `typed.ranges`, `dce` on liveness. A wrong fact gives a wrong program that the gate may or may not catch. The facts can also be checked directly against executions: on every executed statement, every local's value must lie in the interval `rangeView(...).at(stmt, local)` claims. This needs to observe local values during evaluation, which `evaluate` does not offer. A minimal, additive option `observe?: (stmt, locals) => void` in `evaluate`'s options would provide it; everything else (the invariant `typed.ranges-hold`, its report) would live in a new file. It is optional in this milestone and depends on the time left.

# Part 4: Implementation, validation, risks

## 17. Order of work

1. `src/typed/mutate.ts`: sites and operators, the mutant pass, `callersOf`, `finiteDomain`. Tests in `tests/typed/mutate.test.mjs`: enumeration is deterministic; each operator yields a valid revision with the intended change; a known-killable mutant is rejected and a known-equivalent one accepted; `checkInvariant` and `Program.apply` give the same verdict.
2. `tools/mutation-score.mjs`: the default gate over the corpus, aggregation, JSON output. First measurement.
3. The classification cascade, with the exhaustive domains, the large and unconstrained samples, divergence, and the reference oracle. Second measurement, with every survivor classified.
4. `src/typed/cases-strong.ts`: the generator and contract version 2, with tests (the first `count` cases equal `casesFrom`'s; pools contain the boundaries; the default version string is unchanged). Third measurement: kill rate and cost.
5. The f32 fixture and the Candela subset (cheap functions: mean steps per case at r0 below a threshold, every caller cheap too), using the exact shortcut of section 10.
6. Optional: C5.

Everything new lives in new files. `src/typed/evaluate.ts` is not edited unless C5 is done, and then only additively; `src/framework/**` is not edited.

## 18. What must stay identical

The default contract is frozen: generator, count, seed, verdicts, key, and every decision on the corpus and on Candela. Four outputs were recorded before any change (`various/baseline/`, by `scripts/01-freeze-baseline.sh`) and are recorded again at the end and diffed:

| check | baseline |
|---|---|
| `npm test` | 322 pass, 3 skipped (Candela suites), 0 fail |
| `IRWB_FULL=1 node --test tests/typed/passes.test.mjs tests/typed/backend.test.mjs` | 21 of 21 |
| `node tools/parity.mjs` | 44 projects, 70 functions, 6,986 decided agree, 14 inconclusive, 0 failures |
| `08-corpus-revisions.mjs` (IRWB-001) | 44 lines of revision fingerprints |

## 19. Risks and decisions

- **Equivalence is decided by evidence, not proof, for most survivors.** The kill rate is reported as an interval with the method of each classification, and the presumed-equivalent mutants are inspected by hand.
- **Operators define what "a bug" is.** A kill rate is a statement about these operators. The table in section 11 says what each models, and the report gives the rate per operator so that a reader can weigh them.
- **Overfitting the measure.** The strong generator is designed from known weaknesses before it is run against the mutants, and its pools are derived from the program and the specification, not from the mutants. A held-out check: its kill rate on mutants of the r0 base, which were not used while designing it.
- **Cost on Candela.** Only a bounded subset of cheap functions is mutated, one Candela process at a time, with `--max-old-space-size` at most 12288.
- **Decision: the specification bounds the domain.** A mutant that differs only outside the specification is equivalent for the kill rate. The alternative, counting it as a miss, would make the kill rate a measure of the specifications rather than of the sampling. Both numbers are reported.

## 20. Where to look

| question | file |
|---|---|
| How is a pass applied and gated? | `src/framework/passes/define-pass.ts` (`applyPass` :190), `src/typed/program.ts` (`apply` :248) |
| What is the meaning contract? | `src/typed/passes.ts` (`optimizationContract` :221), `src/typed/evaluate.ts` (`meaningKept` :564) |
| How is a sampled check executed? | `src/framework/contracts/differential.ts` (`runDifferential` :102) |
| How are cases generated? | `src/typed/evaluate.ts` (`casesFrom` :230, `makeValue` :128, `F32_EDGES` :194) |
| What is a verdict? | `src/typed/evaluate.ts` (`agrees` :531) |
| How does a pass edit a program? | `src/typed/tx.ts` (`Tx` :165), `src/typed/passes.ts` (`typedPass` :165) |
| What does each project allow as input? | `corpus/projects/*/project.json`, `tools/candela.mjs` (`candelaInputs`), `src/workbench/candela-inputs.ts` |
| The other oracles | `src/typed/reference.ts`, `src/typed/backend/run.ts`, `tools/reference-check.mjs` |
| The agenda items | IRWB-002 design-doc 01, items C5, D2, D5 and section 22 |
| This milestone's evidence | `log/01-gate-strength-diary.md`, `scripts/`, `various/` in this ticket |
