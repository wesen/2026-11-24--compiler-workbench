---
Title: Designing an LZ-style compressor and decompressor for the corpus
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
    - Path: repo://corpus/candela-gallery/kernel.typed
      Note: Frame arrays and explicit loops in hitMesh.
    - Path: repo://corpus/projects/sort/notes.md
      Note: Existing relational bounds-check example.
    - Path: repo://corpus/reference.md
      Note: Workbench calls, input specifications and RV32 measurements.
    - Path: repo://src/typed/evaluate.ts
      Note: Generated argument memory, statement limits and the pass meaning check.
    - Path: repo://src/typed/lift.ts
      Note: Lowering from typed tape to checked addresses, array operations and branches.
    - Path: repo://tools/reference-check.mjs
      Note: Reference and workbench images on the RV32 emulator.
    - Path: repo://vendor/ds-js-os/compiler/typed/typed-wasm.js
      Note: Front-end support for u16 buffers, i32 operations and checked frame arrays.
ExternalSources: []
Summary: Wire format, hash chains, bounds invariants, oracles and measurement plan for a small Typed LZ corpus program.
LastUpdated: 2026-11-26T10:34:54.799547213-05:00
WhatFor: Implementing the lz-roundtrip corpus project.
WhenToUse: Before adding or using the codec as an optimization benchmark.
---

# Designing an LZ-style compressor and decompressor for the corpus

## Executive summary

Add `corpus/projects/lz-roundtrip`, a Typed program that compresses and
decompresses up to 32 UTF-16 code units. It uses a bounded hash chain to
find matches, one-u16 match tokens and forward copies that can overlap
their source. An input buffer controls the search budget. The harness
checks exact round trips and token validity, while the workbench compares
every changed pass with r0 and the reference compiler gives an independent
RV32 lowering. Use the same workloads to measure RV32 instructions.

## What the optimizer should have to discover

Insertion sort already leaves checks on expressions such as `j - 1`
even when the loop guard establishes `j > 0`. The codec adds three
relations that matter in real code. The match loop bounds `i + len` and
reads at `candidate + len`. The encoder's write cursor grows by up to
two cells per consumed input unit. The decoder proves a back-reference
lies in the produced prefix before it copies into the next part of that
same buffer. The chain cursor itself comes from a load. Read the current
`bce` implementation in [passes.ts](../../../../../../src/typed/passes.ts)
alongside [sort's notes](../../../../../../corpus/projects/sort/notes.md)
to identify what it can prove at each access.

| Work | What to look for |
| --- | --- |
| IRWB-003 | Inline the small scalar hash and pack helpers, rotate hot loops when eligible, and measure copy coalescing and constant homes on the same `speed` revision. The inliner currently refuses callees with frame arrays, so do not expect it to inline the compressor into the wrapper. |
| IRWB-006 | Use the SSA view to follow input and output cursors, best length, and the loaded chain link across loop backedges. Inspect rule-table matches in the hash and token fields. |
| IRWB-007 | Fix the read-only policy buffer to `[4]` at the host and see what partial evaluation can recover from its length, load, guard and bound on traversal. Keep source data variable. The scalar/record-field binding pass in `src/typed/specialize.ts` does not supply general constant-buffer loads. |
| IRWB-008 | Track exact evidence for pure integer rewrites and sampled evidence for remaining edits. A rule that rewrites a check or memory access also needs the relevant bounds, effects and alias premises. |
| IRWB-010 | Extract small integer windows around hash mixing, token pack/unpack and masked fields. Check a discovered identity under explicit input ranges, then measure it in the full codec. |
| IRWB-011 | Use the codec as an exact integer control. Every code unit, result length and promised memory effect must agree. |

Write the source as a straightforward greedy codec with named locals,
small helpers and normal loops. Keep Typed's checked accesses in place.
Let the compiler hoist, reuse and simplify them where it can.

## Program interface and layout

All lengths and cursors count u16 cells. The host passes distinct buffers
for every parameter of type `buffer`. Treat `src` and `policy` as
read-only, and take `used` as the length of the stream prefix within
`packed`. The buffer's `.length` is its capacity and never changes.

| Function | Contract |
| --- | --- |
| `lzHash(a: i32, b: i32, c: i32): i32` | Scalar helper. Return `((a * 3) ^ (b * 5) ^ (c * 7)) & 15`. Hash the next three cells. |
| `packMatch(length: i32, distance: i32): i32` | Scalar helper for a verified length in 3–18 and distance in 1–16. Return the match word below. |
| `compress(src: buffer, policy: buffer, packed: buffer): i32` | Return the encoded length. Reject with `-1` before any writes if `src.length > 32`, `packed.length < 2 * src.length`, or `policy` is anything other than one cell containing 1–4. |
| `decompress(packed: buffer, used: i32, dst: buffer): i32` | Return the decoded length. Return `-1` for an invalid stream, including an invalid `used` or output that would exceed `dst.length` or 32 cells. Keep the prefix produced by complete valid tokens before the error. |
| `roundTrip(src: buffer, policy: buffer, packed: buffer, dst: buffer): i32` | Require `dst.length >= src.length` before calling the codec. Compress, decode the emitted prefix, and compare the decoded length and every cell with `src`. Return the packed length on success, `-1` for input or codec rejection, or `-2` for a decoded length or cell mismatch. |

A successful call overwrites just the written prefix of each output
buffer. Sentinel-filled tails let callers test that property. Encode
every possible u16 value, including NUL, isolated surrogates, and
`0xFFFF`. Host fixtures should use arrays of numeric cells.

The compressor owns two zeroed frame arrays, `new Int32Array(16)` for
bucket heads and `new Int32Array(32)` for previous links. They take
192 bytes before alignment, spills and saved registers. Store indices
plus one, reserving zero as the empty link. The other functions use
scalar locals and caller buffers.

The Typed front end implements the required operations in
[vendor/ds-js-os/compiler/typed/typed-wasm.js](../../../../../../vendor/ds-js-os/compiler/typed/typed-wasm.js)
(`codeUnitAddress`, `bufferWrite`, `arrayDeclaration`, `arrayElement`,
and the integer operator table). Frame arrays require literal,
fixed lengths, are zeroed at the declaration, and cannot be passed
as arguments. Keep chain access in `compress` and pass only scalar
cells to `lzHash`. The lifter maps checked text addresses to `caddr`,
u16 access to `load16u` and width-16 stores, and array addresses and
zeroing to `aaddr` and `zero`. The array index guard arrives as
branches and a trap. [Candela's `hitMesh`](../../../../../../corpus/candela-gallery/kernel.typed)
shows frame arrays and dynamic indexed loads in a loop. Sort and
histogram show mutable text buffers and checked loads and stores.

## Token format

The stream is the first `used` cells of `packed`. No header is needed.
Unmarked literals and escaped literals can represent the full input
alphabet, so arbitrary generated u16 text is a valid encoder input.

| Stream cell | Meaning |
| --- | --- |
| `0x0000`–`0x7FFF` | Single literal of the same value. |
| `0xFFFF` | Escape followed by one raw u16 cell in `0x8000`–`0xFFFF`. The payload is data even if it looks like a token. |
| `0x8000`–`0x80FF` | Match word `0x8000 \| ((length - 3) << 4) \| (distance - 1)`. Decode length as `((word >>> 4) & 15) + 3` and distance as `(word & 15) + 1`. |
| `0x8100`–`0xFFFE` | Reserved. Reject. |

Two cells per input unit covers the worst expansion. A match costs one
cell and consumes at least three input cells. Empty input produces an
empty stream. The format operates on u16 words in memory, so there is
no byte serialization, bit reservoir or external format dependency.
Packing the two fields still gives rule discovery useful masks, shifts,
bitwise ORs and offset arithmetic.

## Compressor

Let `n = src.length`, `i` be the next unencoded position and `w` the
write cursor. Validate capacities and load the probe budget once. At the
start of each iteration set the best length and distance to zero.

1. If `i + 2 < n`, hash the triple starting at `i`. Follow its
   bucket's chain newest first, up to the budget. For each nonzero
   link, recover `candidate = link - 1` and `distance = i - candidate`.
   Stop walking the chain once distance exceeds 16 because older
   positions can only increase it. For each eligible candidate start
   `len` at zero and compare `src[i + len]` with
   `src[candidate + len]` while `i + len < n` and `len < 18`.
   Stop extending on the first mismatch. Replace the best pair only
   when this length is strictly longer. Continue via `prev[candidate]`.
2. Emit the best match if its length is at least 3. Otherwise emit
   `src[i]` using the literal or escape form. Advance `w` accordingly.
3. Insert consumed positions in increasing order, starting at `i`
   and ending just before the new `i`. For each such position `p`
   with `p + 2 < n`, compute its hash, set `prev[p] = head[h]`
   and set `head[h] = p + 1`. Then advance `i` by the consumed length.

Searching before insertion prevents a zero-distance match. Newest-first
traversal and strict replacement make ties deterministic. Inserting
positions inside a match lets the next token refer to them. Collision
candidates are compared cell by cell. Two equal triples necessarily hash
together, and collisions affect search effort and compression ratio.

At the start of an iteration every nonzero link refers to an earlier
position in its bucket, so `0 <= candidate < i <= n` before a link
load or comparison. When the comparison body runs,
`candidate + len < i + len < n`. Start each iteration with
`0 <= w <= 2 * i`. Per-token consumption preserves that invariant
and keeps all write indices within `2 * n`. Positions inserted into
`prev` are less than 32, and the hash mask puts every bucket index
in 0–15. All arithmetic on these indices is safely within i32.

## Decompressor

Validate `0 <= used <= packed.length` and `used <= 64` up front.
Then maintain a read cursor `r` and a produced length `w`. Read
a token only when `r < used` and advance `r` past it. For an
escape, require another cell within `used` and a payload of at least
`0x8000`. An ordinary or escaped literal needs room for one cell
within both `dst.length` and 32. For matches, decode both fields and
validate `distance <= w`, `w + length <= dst.length` and
`w + length <= 32` before the first store. Reject reserved words.
Finish when `r == used` and return `w`.

Use an ordinary forward copy, with `w` fixed until the token finishes.

```text
for k = 0 .. length - 1:
    cell = dst.charCodeAt(w - distance + k)
    dst.setCharCodeAt(w + k, cell)
w = w + length
```

The lower source index is nonnegative because `distance <= w`. Its
upper bound at iteration `k` is strictly below `w + k` because
distance is positive. That cell already belongs to the output,
including the part produced earlier in this very copy when
`length > distance`. A snapshot or backward copy would give a
different answer for overlapping repeats. Validate an entire token
before any stores for that token so error results have defined memory.

## Independent oracle and coverage

In `scripts/checks.js`, run the Typed encoder and read exactly its
returned prefix. Decode those cells in an independent JavaScript
parser that uses numeric ranges, division and remainder on the match
payload and appends one cell at a time to a plain array. For each
append in a match it can use `output[output.length - distance]`.
Give the host decoder the same capacity limit as the Typed decoder.
Compare the host result and its length to the original input. Feed
the stream to the Typed decoder in a fresh call with a sentinel-filled
destination and check the result, every output cell, and the tail.
Run `roundTrip` as well and check the returned packed length and
both visible prefixes. Preserve original input and policy cells.
Host fixtures with predefined streams also test the decoder independently
of the encoder. No checksum is needed.

The round-trip property follows by induction over tokens. A literal
reproduces its source unit. For a match the encoder compared the
original at `i + k` with `i - distance + k`. When the decoder
produces cell `i + k`, the referenced cell is earlier, so by
induction it already matches the original. This proof covers every
input of the bounded API. A mutually consistent encoding mistake
could still pass a Typed round trip, so keep exact golden tokens
and check the stream with the host decoder.

| Case | Expected behavior |
| --- | --- |
| Empty, one cell, two cells, distinct low cells | Literal-only round trips, including empty output. |
| `[0x7FFF, 0x8000, 0xD800, 0xFFFF]` | Exact stream `[0x7FFF, 0xFFFF, 0x8000, 0xFFFF, 0xD800, 0xFFFF, 0xFFFF]`. Include 32 high cells with distinct triples to reach the 64-cell output bound. |
| `ABCABCA` | Exact stream `[65, 66, 67, 0x8012]`. Length 4, distance 3, forward overlap. |
| 32 copies of `A` | Exact stream `[65, 0x80F0, 0x80A0]`. Exercises the length cap, tie-breaking, insertion of skipped positions and distance-1 copies. |
| `AAABAAACAAAB` | At index 8, budget 1 emits `0x8003` (length 3, distance 4) followed by literal `B`. Budget 4 emits `0x8017` (length 4, distance 8). Check both decoded outputs. |
| Window edge and collisions | Decode `[0, 1, ..., 15, 0x800F]` to the 16 literals followed by `[0, 1, 2]`. Test encoder candidates exactly 16 and 17 cells old. Use triples formed from multiples of 16 to put unequal cells in one bucket and force multiple probes. |
| Invalid streams and capacities | Negative or oversized `used`, reserved word, truncated escape, low escape payload, match at `w = 0`, distance one greater than `w`, overflow of destination and of the 32-cell limit. Test successful writes followed by failure and all sentinel tails. Test short output buffers, source length 33 and empty, oversized or out-of-range policy. |

## Generated cases and project files

Build `main.typed`, `project.json`, `notes.md`,
`scripts/checks.js` and `scripts/explore.js` in the future project.
Notes explain the wire format and show where to look in IR for
`candidate + len` and the decoder's back-reference. Mark explore
fresh so it can run checked pipelines starting at r0 and focus on
those source locations. Set `focus` to the actual compressor match
comparison line after formatting. Add the project near `sort` and
`histogram` in `corpus/projects/index.json` for UI order. The Node
corpus tools enumerate directories automatically.

Use the following metadata as the starting point. Every function is
listed because an ordinary `Program.fromProject` checks helpers as
direct entries too.

```json
{
  "title": "LZ round trip",
  "about": "Hash chains, packed tokens and overlapping copies.",
  "group": "Programs",
  "sources": ["main.typed"],
  "pipeline": "O2",
  "chapter": "checks",
  "scripts": {
    "checks": { "about": "Check the codec against the wire format." },
    "explore": { "about": "Trace checks and count RV32 instructions.", "fresh": true }
  },
  "inputs": {
    "lzHash": { "a": [0, 65535], "b": [0, 65535], "c": [0, 65535] },
    "packMatch": { "length": [3, 18], "distance": [1, 16] },
    "compress": {
      "src": { "buffer": [0, 32], "cell": [0, 65535] },
      "policy": { "buffer": [1, 1], "cell": [1, 4] },
      "packed": { "buffer": [64, 64], "cell": [43690, 43690] }
    },
    "decompress": {
      "packed": { "cells": [65, 32768, 65535, 55296, 66, 32769] },
      "used": [0, 7],
      "dst": { "buffer": [32, 32], "cell": [43690, 43690] }
    },
    "roundTrip": {
      "src": { "buffer": [0, 32], "cell": [65, 66] },
      "policy": { "buffer": [1, 1], "cell": [1, 4] },
      "packed": { "buffer": [64, 64], "cell": [43690, 43690] },
      "dst": { "buffer": [32, 32], "cell": [43690, 43690] }
    }
  }
}
```

The compressor's full alphabet emphasizes literal and escape handling.
The wrapper's two-symbol alphabet routinely produces matches and
collisions. The standalone decoder's fixed stream with a variable
prefix covers empty, literal, escaped and overlapping output as well
as two failures (`used = 3` cuts the escape and `used = 7`
exceeds capacity). Length and content specs are independent in
`casesFrom`, and the current `oneOf` path coerces its choice to
i32. Use the fixed-capacity scratch buffers and fixture tables above
to cover correlated inputs and exact boundaries. The generated
specs are described in [the corpus API](../../../../../../corpus/reference.md).

## Budget for the 20,000-statement gate

`meaningKept` defaults to 40 cases per function, seed 7, and 20,000
executed BlocksIR statements per case on each side of the comparison.
The evaluator shares the counter with callees. Count branches,
temporaries and array guards as statements, and count the implicit
check in a `caddr` as part of its containing statement. Use the
following work bounds to audit the lifted listing before running
the checks.

| Work in one wrapper call | Bound |
| --- | --- |
| Encoder outer iterations and inserted positions | 32 each. |
| Hash calls | At most 64, one per search and one per insertion. |
| Candidate visits | At most 128, including a visit that stops at the window boundary. |
| Cell comparisons in candidate extension | At most 384. For a literal, the best length is at most 2, so each of at most 4 candidates compares at most 3 cells including a mismatch. For a match consuming `L >= 3` cells each candidate compares at most `L + 1 <= 3 * L`. Sum over consumed input. |
| Encoder stores, decoder input reads, decoder output stores | At most 64 stream stores, 64 stream reads, and 32 output stores. |
| Wrapper verification | At most 32 cell-pair comparisons. |

As an initial allocation, budget 16 statements per cell comparison,
24 per candidate entry/exit, 32 per hash plus its lookup/insertion
bookkeeping, 48 per outer encoder iteration for remaining control
and writes, 32 per stream read, 24 per decoded output cell, and
1,000 for fixed setup, guards and final wrapper verification. The
sum is 16,616 statements using the independent upper bounds. These
are allowances to check against lifted code, not measurements.
In implementation, record the maximum at r0 and after changed
passes for the directed cases and generated matrix. Require zero
inconclusive cases and use 17,000 as a headroom target. If the
lifted listing or measured cases exceed the target, reduce the
default probe cap or input size and update the fixtures and specs
together before relying on the gate. Keep the gate at 20,000.

## Test and measurement plan

1. Ingest the project and verify exact token vectors, error return
   values, successful lengths, prefix side effects and sentinel
   tails with the host harness. Run the directed fixtures and
   generated workloads on r0. Include exhaustive input strings up
   to length 8 over a two-cell alphabet as a small directed sweep.
2. Run checked `O2` and `speed` pipelines from separate r0 copies.
   Inspect pass evidence for disagreements, traps and step-limit
   hits. `p.check` compares the return and guest memory and reports
   agreed traps and inconclusive cases separately. All specified
   failures return `-1` normally, so an agreed trap is unexpected
   even for those cases. Check the default seed and replay several
   fixed seeds, for example 1, 7 and 29. Keep replayable case inputs
   and report which passes changed the main loops.
3. After `npm run build`, use `node tools/reference-check.mjs` for
   the reference image and `node tools/reference-check.mjs --o2`
   for the workbench O2 image. The tool checks generated cases
   against the evaluator and identifies disagreements by function. Read its summary
   and disagreement lines, since the script prints failures rather
   than asserting them. For the directed fixtures and `speed`
   images, use the same `runImage` approach as the tool and
   compare with r0 and the host assertions. Require matching
   outputs and memory with zero codec-run traps or emulator faults.
4. Measure instructions with the emulator on identical numeric
   cell arrays and fresh scratch buffers. Record r0, O2, speed
   with the same backend options, speed with `chains`, `coalesce`
   and `homes` (toggles individually and together), and the
   reference image. Use the literal-heavy, repeated, mixed and
   collision-heavy fixtures with explicitly recorded policy.
   Measure `compress`, `decompress` on the resulting fixed stream,
   and `roundTrip` separately. Report executed instructions,
   input u16 units, encoded u16 units, image bytes, frame size,
   spills and hot source lines where available. Keep compiler
   revision, case values and backend settings with the numbers.
5. For specialization, first run the general image with policy
   `[4]`, then a future specialized image with the same policy
   and the same source cells. An explicit host assumption must
   cover the buffer length, value and immutable use on the tested
   paths. Restrict the specialized correctness cases to that
   assumption and vary the source data. A fixed generator input
   by itself establishes only the workload. A future hand-tuned
   ceiling can live in a separate project, preserving token choice,
   error behavior and scratch side effects on the same inputs so
   the instruction comparison isolates the implementation.

## Implementation order

1. Implement the decoder and scalar pack helper, plus the host token
   parser and exact stream fixtures. Get literal, escape, overlap,
   malformed-prefix and capacity cases passing at r0.
2. Implement the compressor with local frame arrays. Validate the
   dictionary order and budget using the collision, window and
   tie cases. Implement the round-trip entry and run the host and
   Typed checks on generated text.
3. Add the metadata, scripted walkthrough and notes, then verify
   the formatted project is discoverable in the workbench. Use the
   corpus formatting checks in `tests/typed/format.test.mjs`.
4. Audit the lifted step budget, run checked pipelines and both
   RV32 lowerings, then record the instruction baseline and the
   checks that remain in the hot loops. Establish this baseline
   before trying constant-buffer specialization or a tuned ceiling.
