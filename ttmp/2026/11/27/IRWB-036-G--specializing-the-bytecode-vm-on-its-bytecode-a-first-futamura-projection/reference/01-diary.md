---
Title: Diary
Ticket: IRWB-036-G
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological diary of IRWB-036-G: what was tried, what failed, what was measured."
LastUpdated: 2026-11-27T10:01:37.108975859-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

Ticket IRWB-036-G, one session on 2026-11-27. Scripts are in `../scripts/`, run from the worktree root after
`npm run build`.

## Step 1: reading and the baseline

Read the contracts and IR READMEs, `define-pass.ts`, `strategies.ts`, `passes.ts`, `tx.ts`, `specialize.ts`,
`program.ts` (`assume`, `specialize`), the bytecode VM project and its test.

- `npm ci`, `npm run build` (the build takes over two minutes on the shared machine).
- `scripts/01-baseline.mjs --listing`: the r0 listing of `runVm` (99 statements of dispatch, 82 blocks), 7,678
  instructions for Fibonacci, code size is `image.value.bytes` = 840.
- Observations that shaped the design: the fetch is `load16u(caddr(get code, t6)) + 4` with `t6 = pc`; `pc`
  starts as the dynamic `entry`; the stack and the VM locals are the frame array area with bounds checks on `sp`;
  the meaning contract compares the result and the input memory, not the frame.

## Step 2: design (commit c4b4b65)

Design doc written and committed before any code. Decisions: emit every `set` so the general blocks stay a valid
continuation (budget without proof), memoize on live static locals, `entry` as a promised candidate set.

## Step 3: bindings, BTA, first specializer

- `Binding.cells` and `Binding.oneOf`; `Program.assume` passes them through as input specifications;
  `Program.specializeBuffer`.
- `bta.ts`, `scripts/02-bta.mjs`. Result as predicted: with only the buffer bound the static locals are `sp` and
  `t10`, both buffer loads dynamic; with `entry` bound: `entry sp pc t6 opcode t8 operand t10`, both loads static.
- First `specialize-buffer`: one variant per (block, state). **Failed its purpose**: 256 variants used, 2 jumps
  over budget, cells read stopped at 13; the residual program fell back to the general loop at `pc = 14` and was
  slower after `speed` (12,955 instructions). The contract accepted it (40/40), as the fallback argument says.
  Cause: about 15 blocks per guest instruction (the opcode test chain and the join chain), not the 11 I had argued.

## Step 4: transition compression

Decided jumps continue in the same variant; variant boundaries are original loop heads, existing states and
blocks already copied into the variant. 38 variants, the general VM unreachable and pruned by `commit`.
`specialize-buffer` alone: 2,209 / 1,957 instructions, 1,652 bytes. After `speed`: 981 / 995.

## Step 5: frame-slot promotion

- First version required `aaddr` only directly in a load or store. It never fired: after `speed`, licm and lvn had
  moved every `frame+k` into `inv`/`vn` locals; directly after the specializer the front end's
  `t17 = frame+0; store32[t17] = …` blocked it; `subst, subst, dce` did not remove those.
- Second version resolves an address through a local assigned earlier in the same block and removes those
  assignments. Run after `cfg` (so a guest instruction's blocks are one block): fires, 8 slot locals.
  After `speed`: 190 / 177 instructions, 160 bytes.

## Step 6: copies

The listing after promotion is the stack machine in locals (`slot0 = slot24; slot4 = slot20; right = slot4; …`).
`subst` forwards a definition to its single reader and does not handle one local assigned many times.

- `copyprop` (block-local) then `dce`, `speed`: 91 / 103 instructions, 108 bytes; `rotate` now fires because the
  loop head is only its test.
- `copyback` (`t = E; a = t`, `t` dead after): 79 / 79 instructions, 96 bytes. The residual loops are the
  hand-written ones statement for statement, with `== 0` for `<= 0`.

## Step 7: measurements and the other forms (`scripts/05`, `07`)

- Entry unbound: 111 variants (the loop specialized on `sp` alone), slower than the general VM. Negative.
- Budget sweep: every budget below the need of 38 is slower than the general VM at r0, except Fibonacci-only
  damage at 37 where the checksum is complete. Negative result for partial specialization.
- Guard: first version compared each cell through `caddr` (bounds check per cell): 665 instructions at n = 0.
  Second version tests the length once and compares two cells per word: 250. The per-trip cost stays 75 to 80
  because the general loop keeps dynamic frame indices and `frame-slots` is all or nothing.
- A third bytecode image (sum of squares, one entry): 18 variants, 65 instructions against 6,994, 44 bytes.

## Step 8: budget without `speed`, tests, report

- `scripts/08`: without `speed`, partial budgets gain only the specialized prefix (7,055 at budget 0 down to
  6,602 at 37 for Fibonacci): the fallback is one way. With `speed` they are slower, licm's hoisted copies sit
  on a path the multi-entry general loop runs every trip.
- `node --test --test-concurrency=4 tests/typed/*.test.mjs tests/framework/*.test.mjs tests/workbench/*.test.mjs`:
  419 tests, 415 pass, 3 skipped, 1 failure, which was my new trap test comparing a trap message with `true`
  (`RunResult.trap` is the message). Fixed the assertion; `tests/typed/specialize-buffer.test.mjs` then passes 9 of 9.
- No file under `src/framework/` or `src/workbench/` changed, so the site build was not rerun.
- Report written (`analysis/01-…`), design doc got a "Changes during implementation" section.

## What was tricky

- `Tx.block` appends; the new entry has to be `f.blocks[0]`, so the pass moves it to the front itself.
- The guard's tests can only be built after the variants, because they compare the cells the variants read.
- Formatting: `program.ts` was not Prettier-clean before, so it was left as it is; the new files are formatted.

## Review instructions

`node --test tests/typed/specialize-buffer.test.mjs`, then `node <ticket>/scripts/06-final.mjs` for the step list
and the residual listing, and `05-measure.mjs` for the table. Outputs of the last run are next to the scripts
(`*.out.txt`).
