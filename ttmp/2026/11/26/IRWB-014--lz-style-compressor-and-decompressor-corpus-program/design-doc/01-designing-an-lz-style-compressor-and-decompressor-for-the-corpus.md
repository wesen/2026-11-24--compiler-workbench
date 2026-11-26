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
LastUpdated: 2026-11-26T11:00:12-05:00
WhatFor: Implementing the lz-roundtrip corpus project.
WhenToUse: Before adding or using the codec as an optimization benchmark.
---

# Designing an LZ-style compressor and decompressor for the corpus

Add `corpus/projects/lz-roundtrip`, a Typed codec for blocks of up to
32 UTF-16 code units. The encoder uses a bounded hash chain and emits
literals or packed matches. The decoder follows back-references with
overlapping forward copies. The host checks exact round trips and
measures the two kernels on RV32.

## What the program exercises

The encoder reads `src[i + len]` and `src[candidate + len]`; proving both
safe requires relating the indices. It also writes up to two stream cells
per source unit, and uses indices loaded from memory to traverse its
chain. The decoder's match loop reads a cell it may have written earlier
in the same loop. These accesses extend the relational bounds problem
already visible in insertion sort. Keep ordinary loops, named locals and
Typed's checked accesses. [Sort notes](../../../../../../corpus/projects/sort/notes.md)
and [the current BCE pass](../../../../../../src/typed/passes.ts).

| Work | Candidate experiment |
| --- | --- |
| IRWB-003 | Inline the scalar hash helper, rotate hot loops, and compare the `speed` image with and without backend copy coalescing and constant homes. |
| IRWB-006 | Follow the chain link, best match and cursors across SSA backedges. Inspect rules in the hash and token arithmetic. |
| IRWB-007 | Fix the read-only policy buffer to `[4]` and keep the source variable. This exposes the length, load and probe bound to constant-buffer specialization. The current scalar and record-field binding pass does not provide it. |
| IRWB-008 / IRWB-010 | Use hash mixing and field extraction for rule discovery and exact integer rewrites. Bounds-check edits also have to preserve memory effects and traps. |
| IRWB-011 | Use the codec as an exact integer control for tolerance experiments. |

## Interface and tokens

All lengths count u16 cells. The caller supplies distinct buffers.
Reads and writes use `charCodeAt` and `setCharCodeAt`. Buffer `.length`
is its capacity and stays fixed.

| Function | Contract |
| --- | --- |
| `lzHash(a: i32, b: i32, c: i32): i32` | Return `((a * 3) ^ (b * 5) ^ (c * 7)) & 15`. |
| `compress(src: buffer, policy: buffer, packed: buffer): i32` | Return the number of stream cells written. Return `-1` before writing if `src.length > 32`, `packed.length < 2 * src.length`, or `policy` is empty. The first policy cell sets the probe budget, capped at 4. Zero selects literal-only encoding. |
| `decompress(packed: buffer, used: i32, dst: buffer): i32` | Decode exactly the first `used` stream cells and return the number of output cells. Return `-1` for an invalid length, truncated escape, backward distance beyond the produced prefix, or insufficient output space. A failing token leaves only the output from earlier complete tokens. |

Each function writes only its output prefix. The token format handles
every u16 value. The stream length is passed separately.

| Token | Meaning |
| --- | --- |
| `0x0000`–`0x7FFF` | Literal equal to the token. |
| `0xFFFF` | Literal equal to the next cell, read as raw data. The encoder uses this for literals `>= 0x8000`. |
| `0x8000`–`0xFFFE` | Match word `0x8000 \| ((length - 3) << 5) \| (distance - 1)`. Decode as `((word & 0x7FFF) >>> 5) + 3` and `(word & 31) + 1`. |

The high tag identifies a match and the low five bits hold the distance
minus one. The 32-cell source bound keeps encoder matches well away
from the escape word. A match consumes at least three source cells and
writes one token. A literal writes at most two cells, so 64 cells suffice
for any encoded block.

## Encoder

Keep `head = new Int32Array(16)` and `prev = new Int32Array(32)` local
to `compress`. Both start zeroed and total 192 bytes. A link stores the
source index plus one, with zero for the end of the chain. The front end
requires literal frame-array sizes and supports dynamic checked indexing.
The lifter represents checked text addresses as `caddr`, array addresses
as `aaddr` and array zeroing as `zero`.
[Front end](../../../../../../vendor/ds-js-os/compiler/typed/typed-wasm.js),
[lifter](../../../../../../src/typed/lift.ts) and
[Candela's frame arrays](../../../../../../corpus/candela-gallery/kernel.typed).

Let `i` be the next unencoded position, `n = src.length` and `w` be the
stream cursor. Read the probe budget once using
`Math.min(policy.charCodeAt(0), 4)` after validating the buffers.

1. If `i + 2 < n`, hash the three cells at `i`. Follow that bucket
   newest first for at most the probe budget or until the link is zero.
   For each `candidate = link - 1`, start `len` at zero. While
   `i + len < n`, compare source cells at `i + len` and
   `candidate + len`. Stop at the first mismatch. Keep the longest
   match, replacing it only when strictly longer so ties favor the
   nearest candidate. Fetch the next link from `prev[candidate]`.
2. Emit the match if its length is at least 3. Otherwise emit the
   literal at `i`. Advance `w` by the number of cells emitted.
3. Insert every consumed position `p` with `p + 2 < n`, in ascending
   order. Hash its triple to bucket `h`, then set `prev[p] = head[h]`
   and `head[h] = p + 1`. Advance `i` by the consumed length.

Searching before insertion gives `0 <= candidate < i`, so
`candidate + len < i + len < n` whenever the comparison runs. Inserting
positions inside matches keeps subsequent back-references available.
At token boundaries `w <= 2 * i`, so the up-front capacity guard
covers both literal stores. Hash masking and the source bound keep
both dictionary indices in their arrays.

## Decoder

Check `0 <= used <= packed.length`. Maintain read cursor `r` and
output cursor `w`, initially zero. Each iteration reads a token at
`r < used` and advances `r`. For an escape require another cell
before `used`. For a literal require `w < dst.length` before
writing and advancing `w`. For a match require `distance <= w` and
`length <= dst.length - w` before copying.

```text
for k = 0 .. length - 1:
    cell = dst.charCodeAt(w - distance + k)
    dst.setCharCodeAt(w + k, cell)
w = w + length
```

The source index is at least zero and strictly less than the
destination index `w + k`. A forward copy reads the output prefix as
it grows, so distance 1 can reproduce an entire run. Stop when
`r == used` and return `w`. The actual buffer capacities bound the
decoder. Corpus cases allocate 32 output cells.

## Round-trip oracle

Use one `scripts/checks.js` to run `compress`, read its returned
prefix, pass that prefix to `decompress`, and compare the decoded
length and every cell with the original host array. For each match,
the encoder first verified equality between the original cell and an
earlier one. The decoder reads that earlier cell after producing it,
which makes the host input an independent expected result for every
valid input. Use an independent, short JS decoder for successful streams
as well. Decode the match payload with division and remainder and
append from `out[out.length - distance]` one cell at a time. Check
it against the same original to catch mistakes shared by the Typed
encoder and decoder. The JS decoder needs only the valid-stream
grammar. Test rejection and unchanged tails directly on the Typed
functions using sentinel-filled outputs.

| Fixture | Expected check |
| --- | --- |
| Empty and `[0x7FFF, 0x8000, 0xFFFF]` | Empty stream, and exact stream `[0x7FFF, 0xFFFF, 0x8000, 0xFFFF, 0xFFFF]`. Use 32 distinct high literals for the 64-cell capacity boundary. |
| 32 copies of `A` | Stream `[65, 0x8380]` with budget 4. It exercises a 31-cell forward copy from distance 1. |
| `AAABAAACAAAB` | At index 8 budget 1 emits `0x8003` (length 3, distance 4), then literal `B`. Budget 4 emits `0x8027` (length 4, distance 8). Budget 0 emits literals throughout. With `AAABAAACAAAD`, budget 4 keeps the nearer distance-4 match on a tie. |
| `[0, 1, ..., 28, 0, 1, 2]` | Budget 4 emits the initial 29 literals and token `0x801C` (distance 29). The chain visits the colliding triple at index 16 first. |
| Decoder rejection | Try an out-of-range `used`, a trailing escape, a match before there is enough history and a match that exceeds the destination by one. Include a valid prefix before an invalid token to check where writes stop. |
| Encoder rejection | Try a 33-cell source, a buffer shorter than twice the input length, and an empty policy. |

## Corpus files and generated cases

Add `main.typed`, `project.json`, a short `notes.md` pointing to the
match comparison and copy loop, and `scripts/checks.js`. Set
`project.json`'s `focus` to the match comparison line once formatted.
Add the project near `sort` in `corpus/projects/index.json` for menu
order. Node corpus tools discover the directory automatically.
[Corpus API](../../../../../../corpus/reference.md).

Use specs for all three functions because `Program.fromProject`
checks helpers as entries. Consecutive values 32767 and 32768 give
a small alphabet with direct literals, escapes and repeats in one
encoder generator. The decoder generator varies the prefix of a
fixed mixed stream. Prefix length 3 truncates the escape and 7
exceeds the stream buffer.

```json
{
  "title": "LZ round trip",
  "group": "Programs",
  "pipeline": "O2",
  "inputs": {
    "lzHash": { "a": [0, 65535], "b": [0, 65535], "c": [0, 65535] },
    "compress": {
      "src": { "buffer": [0, 32], "cell": [32767, 32768] },
      "policy": { "buffer": [1, 1], "cell": [0, 4] },
      "packed": { "buffer": [64, 64], "cell": [43690, 43690] }
    },
    "decompress": {
      "packed": { "cells": [65, 32768, 65535, 55296, 66, 32769] },
      "used": [0, 7],
      "dst": { "buffer": [32, 32], "cell": [43690, 43690] }
    }
  }
}
```

## Step budget and measurement

The default pass gate compares every changed revision with r0 on 40
cases per function, seed 7, with 20,000 executed BlocksIR statements per
case and side, including callees. Separating the codec calls means each
has its own budget. The encoder can start at most 32 tokens, visit 128
candidates and hash at most 64 triples. A literal can have up to three
comparisons per candidate, including the mismatch. For a match consuming
`L` cells, each candidate can compare at most `L + 1 <= 3 * L` cells.
Thus all candidates together make at most `4 * 3 * 32 = 384` comparisons.
The decoder can read at most 64 stream cells and write at most 32
output cells on the bounded test inputs. Use these counts to audit the
lifted hot paths and record maximum evaluator steps on both generated
cases and directed fixtures. Require no step-limit cases at the
20,000 limit. If the measured margin is small, reduce the block or
probe bound and update its fixtures before taking baseline numbers.
[Evaluator and pass gate](../../../../../../src/typed/evaluate.ts).

1. Implement the token decoder and host fixtures first. Then implement
   the hash-chain encoder, run the host round-trip checks, and add the
   project metadata and notes. Run the corpus format checks.
2. Start `O2` and `speed` from separate r0 copies with per-pass checking.
   Check returns and guest memory. A trap or step-limit hit on a codec
   case is unexpected, including the rejection fixtures, which return
   `-1`. Use the directed fixtures on the resulting images too.
3. After `npm run build`, run `node tools/reference-check.mjs` and its
   `--o2` mode for generated cases. Inspect the printed summary and
   disagreements. Reuse its `runImage` path for directed fixtures and
   the `speed` image. [Reference checker](../../../../../../tools/reference-check.mjs).
4. Record emulator instructions separately for `compress` and
   `decompress` using the same literal-heavy, repeated and collision
   fixtures, policy values and fresh buffers on each image. Feed every
   decoder the same verified stream. Compare r0, O2, speed, speed
   with `chains`, `coalesce` and `homes` enabled, and the reference.
   Keep the case inputs, revision and backend settings with the
   numbers. Inspect remaining checks and toggle individual backend
   options when attributing a difference.
5. For the later specialization experiment compare general and
   specialized images on identical variable source cases with
   `policy = [4]`. The specialized gate and runs must honor the
   explicit constant-buffer assumption. A separately authored
   hand-tuned project may provide an instruction-count ceiling
   with the same codec behavior.

## Cuts from self-review

- Removed the Typed round-trip wrapper and its mismatch code. The host already sees both outputs and owns the equality check.
- Folded the scalar pack helper into the encoder. The hash helper still exercises inlining, and packing still exposes the same kind of integer expressions.
- Removed the separate window and match-length limits. The bounded block and probe count already bound the search and preserve relational accesses.
- Simplified the token grammar and decoder guards. One escape plus match fields covers the alphabet, and actual capacities bound safe decoding.
- Simplified policy validation to a first-cell cap. An input-controlled budget is enough for the specialization experiment.
- Merged the encoder input generators and trimmed overlapping fixtures. One small alphabet straddles the literal boundary, with directed data for the full-u16 and long-distance cases.
- Dropped the second walkthrough script and decorative metadata. The oracle script and ordinary corpus tools cover checking and exploration.
- Dropped the speculative statement-cost table and secondary headroom threshold. Bound the loop work and check the actual gate with evaluator counts.
- Trimmed the test and reporting matrix. Directed boundaries plus the standard generated checks and per-kernel instruction counts answer the experiment.
- Consolidated repeated implementation and correctness prose. The codec, corpus setup and measurements each have one task sequence.
