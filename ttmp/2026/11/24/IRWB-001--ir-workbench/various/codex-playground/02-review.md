# Review: six Codex design docs (gpt-6.2-sol, medium) for the optimization playground

Date: 2026-11-26. Reviewer: the coordinator (Claude). Brief: `prompts/00-common.md` plus one file per program. Launcher: `../../scripts/15-codex-playground-launch.sh`. Logs: `logs/`.

The question was whether the model over-complicates. I read all six docs in full and checked their technical claims against the code. One probe reproduced a claimed blocker.

## Results at a glance

| ticket | program | branch head | minutes | tokens | words | node probes | added complexity | grounding |
|---|---|---|---:|---:|---:|---:|---|---|
| IRWB-012 | bytecode VM | `4038fb8` | 6 | 105,577 | 3,516 | 0 | medium-high | medium: missed the ingest blocker |
| IRWB-013 | SHA-256 + ChaCha20 | `a493a0b` | 5 | 129,434 | 3,003 | 1 | low | good: missed the ingest blocker |
| IRWB-014 | LZ codec | `43baa4b` | 6 | 121,076 | 3,553 | 0 | medium-high | medium: missed the ingest blocker |
| IRWB-015 | Thompson-NFA regex | `8ba5bba` | 8 | 138,281 | 4,311 | 5 | medium-high | best: found the blocker |
| IRWB-016 | f32 FFT + biquads | `07592d2` | 6 | 113,893 | 3,277 | 0 | low-medium | good |
| IRWB-017 | chess port | `8daa63c` | 7 | 122,784 | 3,659 | 6 | high (avoidable) | good: measured the budget |

**Process compliance was complete in all six.** Each agent:
- wrote only inside its own ticket;
- made one commit with the requested message;
- kept a diary of 3–4 steps;
- related 7 files to its doc;
- got a clean `docmgr doctor`;
- ran nothing from `ttmp/**/sources/`. Its searches excluded that path explicitly; the log hits are file listings.

## Verified claims
- `match` requires an enum (`typed-wasm.js:1707`).
- Frame arrays cannot be passed to functions; the inliner refuses callees that have one (`inline.ts:128–139`).
- The `cells`, `string`, `buffer`, `floats`/`range` and `record` input specs all exist (`evaluate.ts:142–168`).
- `Sha256` exists in `src/framework/core/sha256.ts:108`.
- The backend has a `registers` budget option.
- `chapter` is a real project field.
- The front end has no `sin`/`cos`. The FFT's half-angle twiddle recurrence through `Math.sqrt` is therefore necessary, not clever for its own sake.

**IRWB-015's blocker is real.** Default ingest of any function containing `new Int32Array(n)` fails with `unknown tape opcode 252`; `{ tape: true }` works. I reproduced this with `scripts/16-probe-int32array-ingest.mjs`. On top of that:
- `Program.fromProject` and `ingestProject` drop the project's `ingest` metadata. Only the site's loader passes it through (`projects.ts:248`).
- So IRWB-012, -013 and -014, which all use frame arrays, fail at their first implementation step as written.
- IRWB-017 notes that the `entries` option is not wired through project metadata either (`program.ts:132`), which is also true.

## Where the complexity comes from
The core programs are not over-complicated:
- the sizes are small and chosen against the 2e4-statement pass limit: 192 dispatches, two SHA blocks, 32 LZ cells, 12 text units, 32-point FFT;
- the algorithms are the standard ones;
- several design choices are good, for example fixed-width VM instructions and DSP oracles independent of the implementation.

The over-complexity sits in the **contract around** each program:
1. **Invented error interfaces.** Each doc defines its own status codes, with a specified checking order and guarantees that nothing is written before an error:
   - IRWB-012 has 10 status codes and a fuel counter;
   - IRWB-014 has `-1`/`-2` and defined partial output on error;
   - IRWB-015 makes the status depend on which error the parser meets first.

   Every status has to be duplicated in the oracle and tested, and none of it exercises the optimizer. For a playground, "valid inputs only; anything else traps" is enough.
2. **Input domains wider than the experiment needs:**
   - the full u16 alphabet in LZ, which forces an escape-token format;
   - malformed patterns and five input profiles in regex;
   - alternate SHA constant tables and arbitrary i32 counters;
   - NaN payloads and subnormals in the DSP.

   The input specs are ours to restrict.
3. **Boundary tests of the program's own guards:** the 192nd fuel instruction; sentinel tails everywhere; a test that a specialization router does not choose the specialized image, when no such router exists.
4. **Test plans for features that do not exist yet:** specialization dispatch, FMA emission (IRWB-016's 2^-23 witness), constant-memory bindings.
5. **Self-defeating choices:**
   - IRWB-012's fuel counter is loop-carried state. The doc itself says specialization must preserve it, so it works against the Futamura experiment that is the program's purpose.
   - IRWB-017 identifies the missing `entries` wiring, then designs coherent generated fixtures for all 53 functions (mid-search frame and undo snapshots) instead of proposing a few lines of wiring and an entry-only contract.
6. **Prose:** dense specification text with few worked examples or diagrams. IRWB-017 has no code blocks at all. The docs are implementable by an expert, not the intern guide the brief asked for.

A smaller point: IRWB-015's oracle anchors with `(?![\s\S])` to avoid matching before a trailing newline. In JavaScript without `m`, `$` already behaves that way (`/^(?:a*)$/.test("aa\n") === false`). This is harmless.

## Real findings worth keeping
- **IRWB-015:** the ingest blocker and the loader gap (above).
- **IRWB-017:** opening perft 1 takes 20,778 evaluator statements, over the 20,000 limit. Opening perft 2 takes 448,155. The pass gate can only see tiny positions, so chess needs entry-only contracts or a larger limit.
- **IRWB-013:** for `rotr(x, 0)`, `(x >>> 0) | (x << 32)` relies on RV32's 5-bit shift masking. An OR-to-XOR rewrite of the rotate idiom is wrong at counts 0 and 32.
- **IRWB-014:** the index invariants `0 <= candidate < i <= n` and `w <= 2i` are exactly what BCE has to prove. Its `roundTrip` wrapper puts the round-trip property inside the checked program.
- **IRWB-016:** the oracles are independent of the implementation: an O(N²) DFT, and a transposed direct form II against the program's direct form I.

## What the brief caused (my part)
- **"Constants worth specializing on (a bytecode, a pattern, a size) live in input buffers."** This produced the 1-cell `policy` and `config` buffers (IRWB-014, -016) and the K/sigma buffers (IRWB-013). A scalar parameter would do, and the scalar specializer already handles scalars.
- **Six tickets to feed.** This produced a six-row optimization table in every doc. Four of them carry an IRWB-011 row whose only content is "this is an exact integer control".
- **"Do not modify `src/`".** This may have kept IRWB-017 from proposing the `entries` wiring. IRWB-015 proposed its own fix anyway.

## Cuts recommended before implementation
- **Infrastructure first:** pass `ingest` and `entries` from `project.json` through `Program.fromProject` and `ingestProject`. This unblocks IRWB-012..015 and simplifies IRWB-017.
- **IRWB-012:**
  - valid bytecode only, trap on error;
  - return the result directly;
  - drop fuel (the fixtures terminate) and the router test.
- **IRWB-013:**
  - keep the design;
  - optionally make the K table a constant in the program, with a buffer variant only for the specialization experiment.
- **IRWB-014:**
  - restrict cells to 0..0x7FFF and drop the escape token;
  - make the probe budget a scalar parameter;
  - the decoder may trap on streams the encoder never produces.
- **IRWB-015:**
  - valid patterns only, with one fixed pattern per profile and two profiles;
  - drop the error-precedence rules and the grammar fuzzer.
- **IRWB-016:**
  - drop the FMA witness and the NaN-payload replays until the backend can contract;
  - make `log2N` a scalar.
- **IRWB-017:**
  - an entry-only contract on `chessPerft` and `chessRunSearch`;
  - drop the per-function fixture regime.
