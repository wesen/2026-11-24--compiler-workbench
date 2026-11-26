---
Title: LZ-style compressor and decompressor corpus design
Ticket: IRWB-014
Status: active
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/projects/sort/main.typed
      Note: Existing offset-index bounds workload
    - Path: repo://corpus/reference.md
      Note: Project metadata, input specifications, and workbench APIs
    - Path: repo://src/typed/evaluate.ts
      Note: Generated cases, observations, and the per-case statement limit
    - Path: repo://src/typed/lift.ts
      Note: Normal ingestion, tape ingestion, and integer and memory lowering
    - Path: repo://src/typed/program.ts
      Note: Project loading and checked pipeline entry points
    - Path: repo://src/typed/specialize.ts
      Note: Supported specialization bindings and the constant-data gap
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler and emulator workflow
ExternalSources: []
Summary: A bounded LZ-style workload for relational bounds, bit rewrites, and RV32 speed measurements.
LastUpdated: 2026-11-26T11:54:22.853698635-05:00
WhatFor: ""
WhenToUse: ""
---

# LZ-style compressor and decompressor corpus design

Build one Typed corpus project, `lz-roundtrip`, that finds repeated byte sequences with a hash chain, emits literal and match tokens, and reconstructs the original bytes. The hottest loops should look like ordinary scalar code. Keep calls, forward copies, and the bounds checks Typed inserts. The benchmark is how many RV32 instructions the compiler needs to execute that code on identical inputs.

## Supported inputs and representation

The source is a `buffer` of 0–24 cells. Each cell contains a byte (0–255) in a u16 slot. A one-cell read-only `policy` buffer supplies the maximum number of candidates per hash lookup (1–4). Each buffer argument has separate storage. The writable buffers start with arbitrary u16 contents.

| Buffer | Capacity | Purpose |
| --- | ---: | --- |
| `work` | 0–24 | Source bytes, with logical length `work.length` |
| `policy` | 1 | Probe cap at cell 0 |
| `packed` | 24 for compression | One u16 cell per token, with logical length returned by `compress` |
| `heads` | 16 | Most recent position per bucket, stored as position plus one |
| `prev` | 24 | Previous position in the same bucket, stored as position plus one |
| `decoded` | 24 | Reconstructed bytes, with logical length returned by `decompress` |

For a standalone decoder call, `packed` may have any capacity up to 24 with `0 <= used <= packed.length`. Its first `used` cells must be valid tokens. Every match refers to a positive distance at most equal to the number of bytes produced so far, and the whole stream expands to at most 24 bytes. The empty stream produces zero bytes. Both encoders and decoders write only the logical prefix of their output buffer.

Each literal is the byte itself. A match is `32768 | ((length - 3) << 5) | distance`. Bit 15 marks a match, bits 5–7 encode lengths 3–10, and bits 0–4 encode distances 1–23. Bits 8–14 of a match are zero. This uses one cell for any token, so an input of length `n` takes at most `n` cells. A tagged token pair would be simpler to decode, but the single-cell format makes the capacity bound simple and leaves useful mask and shift expressions for the compiler. Compression here is measured in tokens per input cell. A byte-packed file format and interoperability would add parsing work unrelated to this experiment.

## Typed functions

The signatures below specify the complete call graph. All four functions have generated cases because the normal corpus loader checks each function directly.

```text
hash3(a: i32, b: i32, c: i32): i32
compress(work: buffer, policy: buffer, packed: buffer,
         heads: buffer, prev: buffer): i32
decompress(packed: buffer, used: i32, decoded: buffer): i32
roundTrip(work: buffer, policy: buffer, packed: buffer,
          heads: buffer, prev: buffer, decoded: buffer): i32
```

**Finding matches.** Use `hash3(a, b, c) = (a * 31 + b * 7 + c) & 15` on byte triples. Clear all heads to zero at the start of each call. Each linked index is written to `prev` before it can be reached, so incoming predecessor contents do not affect the search. Starting at source position `i = 0`, search only when `i + 3 <= n`. Read the head for the query hash, then follow links from newest to oldest for at most `policy.charCodeAt(0)` candidates. Read the probe cap once before the outer loop.

For each nonzero link, set `candidate = link - 1` and compare bytes starting at `candidate` and `i`. Begin with length zero and extend while `len < 10 && i + len < n` and the two bytes agree. Use a simple forward loop with a break on mismatch. Keep the longest match of at least three bytes and replace it only for a strictly greater length, so ties go to the closest candidate. Hash equality only selects candidates. A linear backward scan would be simpler, but would omit the pointer-chasing loads and collision behavior this project is meant to expose.

**Emitting tokens and updating the chain.** Emit one literal and consume one byte when no match qualifies. Otherwise emit one match and consume its length. After emitting either token, insert every consumed position `j` for which `j + 3 <= n`, in increasing order, including positions inside a match. At each insertion compute the triple hash, store the old head in `prev[j]`, then set the head to `j + 1`. Keep the current position out of the chain until its token has been chosen. Tracking only token starts would save insertions but miss matches beginning inside earlier tokens and change the search workload. Return the number of cells written to `packed`.

**Decoding.** For each of the first `used` cells, test `token & 32768`. Append `token & 255` for a literal. For a match, read `distance = token & 31` and `length = ((token >>> 5) & 7) + 3`. Copy forward one cell at a time from `written - distance` to `written`, advancing `written` after each store. The next iteration can read a byte just written, which is necessary when length exceeds distance. A reverse copy would instead read cells before they have been produced. Return `written`. The wrapper calls both functions, checks the decoded length against `work.length`, then compares every byte. Return 1 for equality and 0 for a mismatch.

**Why the indices stay in range.** During search each candidate is strictly earlier than `i`. If `i + len < n`, then `0 <= candidate + len < i + len < n`. Each insertion uses a valid triple and a predecessor index below 24. Each token consumes at least one byte, so the output index stays below the source length before a write. During a match copy, `1 <= distance <= written` and `written < decoded.length` give `0 <= written - distance < written < decoded.length`. The search compares against the original bytes even when a match overlaps. By induction on bytes written, the decoder reads the same byte the compressor compared, including when that byte came from an earlier iteration of the current match. Literals preserve the next byte directly. This gives exact round-trip equality over the supported source domain.

**Loader constraints.** The front end lowers buffer accesses to checked addresses, unsigned u16 loads, and u16 stores. A small in-memory probe using `Program.fromProject` exercised buffer reads and writes, a helper call, short-circuit loops, shifts, masks, and generated buffer inputs. Both the checked `speed` pipeline and the reference RV32 image agreed on the probe. The same default loader rejected a frame array with `unknown tape opcode 252 at 9`. Candela's tape ingestion option compiled and evaluated the tiny frame-array probe, but `Program.fromProject` does not select it. A separate six-argument probe using the proposed manifest agreed across the evaluator and both RV32 images on 40 cases at seed 7, covering all four caps and 21 distinct input lengths. Caller-supplied scratch buffers avoid a loader change and keep the memory traffic visible to the pass checker. See `src/typed/lift.ts`, `src/typed/program.ts`, `corpus/candela-gallery/kernel.typed`, and the buffer loops in `corpus/projects/sort/main.typed`.

## Project files and generated inputs

Put the four functions in `corpus/projects/lz-roundtrip/main.typed`. Add `notes.md` with the token layout, a fixture, and the two hot access sites to inspect. Use `scripts/explore.js` for a fresh workbench run of the fixed fixtures and a before/after instruction table. The loader discovers project directories and includes unlisted ones after the curated order in `corpus/projects/index.json`. No index edit is required for discovery. See `tools/corpus.mjs` and `corpus/reference.md`.

Use this `project.json` as the starting point. Replace the example `focus` line with the actual first comparison load in the match loop. O2 is the default so results can be compared with Sort and Histogram. Run `speed` as a separate experiment from r0.

```json
{
  "title": "LZ round trip",
  "about": "Hash-chain match finding, packed tokens, and overlapping copies.",
  "group": "Programs",
  "sources": ["main.typed"],
  "pipeline": "O2",
  "focus": 1,
  "scripts": { "explore": { "about": "Check fixtures and compare RV32 instructions", "fresh": true } },
  "inputs": {
    "hash3": { "a": [0, 255], "b": [0, 255], "c": [0, 255] },
    "compress": {
      "work": { "buffer": [0, 24], "cell": [0, 255] },
      "policy": { "buffer": [1, 1], "cell": [1, 4] },
      "packed": { "buffer": [24, 24], "cell": [0, 65535] },
      "heads": { "buffer": [16, 16], "cell": [0, 65535] },
      "prev": { "buffer": [24, 24], "cell": [0, 65535] }
    },
    "decompress": {
      "packed": { "cells": [65, 32769, 255] },
      "used": 2,
      "decoded": { "buffer": [24, 24], "cell": [0, 65535] }
    },
    "roundTrip": {
      "work": { "buffer": [0, 24], "cell": [0, 3] },
      "policy": { "buffer": [1, 1], "cell": [1, 4] },
      "packed": { "buffer": [24, 24], "cell": [0, 65535] },
      "heads": { "buffer": [16, 16], "cell": [0, 65535] },
      "prev": { "buffer": [24, 24], "cell": [0, 65535] },
      "decoded": { "buffer": [24, 24], "cell": [0, 65535] }
    }
  }
}
```

`casesFrom` generates each parameter independently and its `oneOf` branch converts choices to i32. Use one fixed valid decoder stream in the manifest and exercise diverse streams through `roundTrip` and explicit fixtures. Random token cells would mostly test inputs outside the decoder's domain. Use the wide byte range to exercise literals and collisions, and the small alphabet to increase the chance of matches. Use dirty scratch and output buffers to expose missed initialization or writes past the output prefix.

## Oracles and acceptance

Use the original byte array as the independent expected value for every round trip. Also write a small JS decoder for the test harness with ordinary arrays, arithmetic division and remainder to parse tokens, and an append per copied byte. Compare its full output with the input for every Typed `compress` run and feed its expected output to comparisons on runs of Typed `decompress`. Check `roundTrip` returns 1 and that its actual decoded prefix agrees cell for cell. This catches mutually compensating changes to the Typed encoder and decoder. An encoder clone would duplicate the hash-chain logic and could repeat the same search bug, so check selection rules with golden token sequences instead. Check output lengths, untouched tails at their initial values, and unchanged `work` and `policy`.

In the Node harness, take seeded cases from `casesFrom(storeOf(p.origin.value), fn, { inputs: p.inputs[fn], count, seed })`, use the case's memory items and `readBuffer` to recover original cells and outputs, and reuse the same case for all engines. The workbench's `p.cases()` returns argument pointers and item metadata, so the workbench exploration script can use explicit arrays for its fixtures. Require every generated or explicit valid case to complete without traps or limits. Include the following fixtures in addition to seeded cases.

| Input or stream | Expected evidence |
| --- | --- |
| Empty source, one byte `255`, two bytes `[0, 255]` | Respectively zero, one, and two literal tokens |
| Bytes `0..23` in order | 24 literals fill the output exactly |
| Eleven copies of `65` | `[65, 32993]` (length 10, distance 1), with a match ending at EOF |
| `[0,16,32,0,16,32]` | All triples hash to zero. Cap 1 emits six literals. Cap 4 emits `[0,16,32,32771]`, selecting the older candidate |
| `[65,66,67,65,66,67,65,66,67]` | `[65,66,67,32867]` (length 6, distance 3), testing a period-three forward copy |
| Standalone stream `[65,32769,255]` with `used = 2` | Decode four copies of `65`, ignoring the physical tail |
| Standalone stream `[65,66,67,32771]` with `used = 4` | Decode six bytes and exercise length equal to distance |

The pass gate is `meaningKept`: compare each changed revision to evaluator r0 on generated cases, including written memory. Keep per-pass checking enabled and inspect rejected steps, inconclusives, and counterexamples. Run `node tools/reference-check.mjs` after building to compare r0 with the reference compiler's RV32 image. Also compare workbench O2 and `speed` images with r0 using the same cases and run the independent JS checks against their outputs. The reference image cross-checks compiler semantics. Round-trip equality independently checks the workload's expected result. See `casesFrom`, `evaluate`, and `meaningKept` in `src/typed/evaluate.ts`, and `tools/reference-check.mjs`.

## Size and instruction measurements

One compression call does at most 24 token iterations, 24 insertions, 96 candidate visits, and 960 comparisons, even if every token looked at four candidates and each comparison loop reached its 10-byte cap. Decoding consumes at most 24 tokens, produces at most 24 bytes, and the wrapper compares at most 24 bytes. The pass limit is 20,000 executed IR statements per case, including callees. A planning allowance is 12 statements per comparison iteration, 18 per candidate beyond comparisons, 24 per compression token beyond candidate search, 24 per insertion, and 20 per decoded token plus 28 per byte for the decode and equality loops. Allow another 256 for head reset and setup. These allowances sum to about 15,800 statements. They are sizing estimates for the proposed source, pending measurement on lifted IR.

Before running pipelines, record the maximum observed steps at r0 with the 20,000-statement limit, including 24-cell repetitive, alternating, unique, and collision-heavy inputs at cap 4 and seeded cases. Use evaluator counts to identify expensive blocks and repeat for accepted revisions. Target at most 16,000 observed statements and zero inconclusive cases. If the measured budget is tight, reduce the input length ceiling and update the fixtures, manifest, and supported domain together. Keep the probe cap high enough to traverse collisions. A bigger input would give longer traces, but increases check cost without requiring a new code path.

For each fixture family, run r0, O2, and `speed` from identical starting cases on the RV32 emulator. Use `lowerToImage` and `runImage` in Node or the image handles in the workbench. Report executed instructions for compression, decoding, and round trip separately, using identical pre-encoded streams for decoder comparisons. Report image bytes, tokens, and RV32 instructions per input byte for nonempty round trips. Compare all three revisions with identical backend options first, then toggle `chains`, `coalesce`, and `homes` on the same `speed` revision to measure backend effects. Inspect hot source lines, remaining bounds branches, and spills. Test performance claims by case family. A gain on a literal-heavy input may disappear on an overlapping copy or high-collision chain.

## Optimization experiments

| Work | What to inspect |
| --- | --- |
| IRWB-003 | Inlining `hash3`, rotating the candidate and copy loops, coalescing index temporaries, and the estimated payback from keeping masks and constants in registers. Inspect whether `speed` inlines the larger encoder and decoder or leaves the wrapper calls. |
| IRWB-006 | Inspect rule-table coverage for integer masks and shifts and SSA joins and loop-carried values for the current and best match lengths, link, and write cursor. Inspect how the bounds proof for `candidate + len` needs a relation between two indices, just as Sort needs a fact about `j - 1` beyond the range of `j`. |
| IRWB-007 | Use the read-only one-cell probe cap as constant data. Run the general build across caps 1–4 and keep paired fixtures with the same bytes and policy `[4]` for a future specialized comparison. Hardwiring the cap in source would fold a constant without exercising constant memory. |
| IRWB-008 | Use bit expressions to test rule-backed exact checks where applicable, and retain sampled and independent checks for structural edits involving loads, branches, and overlapping stores. |
| IRWB-010 | Collect the actual IR trees around token tagging, extraction, and the hash as candidate windows. Compare hand-listed candidates using verified guards and measured instruction costs. |
| IRWB-011 | This integer workload can serve as an exact-comparison control. Float tolerance and rendered outputs are outside its scope. |

## Implementation order

1. Add the manifest and four signatures in the new project. Implement literal emission and the decoder first, including forward overlap. Check the hand-authored decoder streams through the normal loader and both engines.
2. Add `hash3`, scratch initialization, and the bounded chain search. Implement insertion for every consumed position. Run the independent decoder, golden encodings, and dirty-buffer cases before enabling pipelines.
3. Land the seeded oracle tests using the existing Node test harness and measure evaluator steps. Confirm the reference image and checked pipelines agree, with zero inconclusives.
4. Add notes and the exploration script. Record instruction counts and identify the load or branch at the chosen focus line.

## Later

- For IRWB-007, extend specialization bindings to read-only buffer cells with a corresponding restricted case contract. The current `src/typed/specialize.ts` accepts scalar parameters and record fields. Fixing a buffer spec to `{ "cells": [4] }` exercises fixed data without giving the optimizer a binding.
- For IRWB-010, feed the collected windows to equality saturation or a superoptimizer once a search engine exists.
- If a speed ceiling is needed, add a separate hand-optimized project using the same token format and golden outputs after the ordinary source has a measured baseline. This design covers one project.
