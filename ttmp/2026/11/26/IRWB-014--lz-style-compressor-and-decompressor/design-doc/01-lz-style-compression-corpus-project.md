---
Title: LZ-style compression corpus project
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
      Note: Corpus example of checked loop-carried indices
    - Path: repo://src/typed/evaluate.ts
      Note: Generated input schema and the sampled statement-budget contract
    - Path: repo://src/typed/lift.ts
      Note: Tape ingestion and lowering for checked buffers and local frame arrays
    - Path: repo://src/typed/program.ts
      Note: Node loader and scalar specialization entry points
    - Path: repo://src/typed/project.ts
      Note: Direct corpus ingestion and project metadata
    - Path: repo://src/workbench/projects.ts
      Note: Existing browser ingestion metadata handling
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler and emulator oracle integration
ExternalSources: []
Summary: A bounded hash-chain codec with a byte-for-byte round-trip oracle for checked Typed optimization.
LastUpdated: 2026-11-26T10:57:57.845019218-05:00
WhatFor: ""
WhenToUse: ""
---

# LZ-style compression corpus project

## Goal

Add `lz-roundtrip` to the Typed corpus. The compressor finds repeated runs through a hash chain, emits literals and back-references, and hands the stream to a decoder that copies matches from its own output. Insertion sort already exposes checks on indices such as `j - 1`. This project adds checked accesses to two independently computed positions, `i + len` and `candidate + len`, as well as a copy whose read index `written - distance` depends on the decoded token. The hash chain and decoder both carry values from one iteration to the next. Hashing and token packing give integer rewrite rules small expressions to work on.

Write the baseline as ordinary straight-line code and loops. Use source-level helpers where they describe an operation and leave the memory accesses checked. A backwards scan of all earlier positions would be simpler, but it would omit the computed bucket access and the dependent link loads. A single previous position per bucket would exercise hashing but could never recover a match behind a collision.

- **IRWB-003** exercises hash-helper inlining, loop rotation, register copy coalescing, and register homes for repeated constants through `speed` and its backend options.
- **IRWB-006** gives rewrite tables and the SSA view concrete integer expressions and loop-carried positions to inspect.
- **IRWB-008** gives exact rule checking a candidate in the pure mask and shift expressions that extract fields from a loaded token.
- **IRWB-010** gives rule discovery windows in the hash arithmetic and field packing and extraction.

## Functions and data layout

```text
hash3(a: i32, b: i32, c: i32): i32
compress(input: buffer, packed: buffer, chainLimit: i32): i32
decompress(packed: buffer, packedLen: i32, output: buffer): i32
roundTrip(input: buffer, packed: buffer, output: buffer, chainLimit: i32): i32
```

The source holds 0 to 24 seven-bit characters, one per u16 cell in a Typed `buffer`. The caller supplies distinct packed and output buffers of 24 cells each. A token represents one logical byte stored in one cell. The compressor returns the number of cells written into `packed`, and the decoder returns the number of cells written into `output`. The stream needs no header because the decoder takes the encoded length as a scalar. This also lets the same decoder consume a prefix of the fixed-capacity scratch buffer. Each token consumes at least one source cell, so the worst encoded size is exactly the input length. The experiment measures instructions on this representation. Two buffers of 24 cells suffice even for all literals.

| Token | Byte layout | Meaning |
| --- | --- | --- |
| Literal | `0ccccccc` | Emit character `c` in the range 0–127. |
| Match | `1llddddd` | Copy `ll + 3` cells from a distance of `ddddd + 1`. The compressor emits lengths 3–6 and distances up to 23. |

Use a single tagged byte so that every match saves cells and field extraction remains visible in the IR. A tag, length and distance in separate cells would be easier to inspect but would remove the bit operations and consume three cells for a three-character match. The seven-bit source alphabet leaves the tag available without escape tokens.

Use `new Int32Array(16)` for bucket heads and `new Int32Array(24)` for previous links, both local to `compress`. Together they take 160 bytes of frame storage. Use one-based position links so zero is the end of a chain and the arrays' zero initialization suffices. A caller-supplied scratch buffer would make array storage visible as another output of the pass oracle. Frame arrays keep the dictionary local and save callers from constructing it. Compute `hash3` as `((a * 31 + b) * 31 + c) & 15`. The current inliner skips callees with frame arrays, so the call to `compress` stays and the small `hash3` calls are the inlining sites. Hash three characters because three is the smallest encodable match. A one-character hash is simpler but wastes most visits on candidates that share only the first character.

### Compress

Let `n = input.length`. Walk input position `i` and packed position `k` forward from zero. At each token start set `bestLen = 0` and `bestDistance = 0`. Search only if `i + 3 <= n`. Load the next three characters, call `hash3` into a local, and start at that bucket's head. Visit at most `chainLimit` nonzero links, newest first. Convert a link to `candidate = link - 1`. Compare characters from the start, advancing `len` only while `len < 6`, `i + len < n`, and the two cells agree. Read the cells only after the first two conditions hold. All candidates precede `i`, so the same end test also makes `candidate + len < n`. Update the best match only on strictly greater length, which keeps the nearest candidate on ties. Follow `prev[candidate]` for the next visit.

Emit a literal if `bestLen < 3` and advance by one. Otherwise emit `128 | ((bestLen - 3) << 5) | (bestDistance - 1)` and advance by `bestLen`. Set `bestDistance = i - candidate` when selecting the candidate. Before advancing `i`, insert each consumed position `p` from `i` through `i + advance - 1` that satisfies `p + 3 <= n`. Hash its three cells, set `prev[p] = head[bucket]`, then set `head[bucket] = p + 1`. Increment `k` once per token and return it at the end.

Searching before insertion excludes self-matches. Inserting only token starts is simpler but omits valid candidates inside matched runs and removes the loop that builds chains across skipped positions. Hashing again during insertion keeps search and dictionary updates easy to follow and leaves reuse to the optimizer. Take `chainLimit` as a scalar in 1–3. A hardcoded visit limit is simpler, but a scalar keeps the same source usable for general runs and specialization.

### Decompress and round trip

For each packed position below `packedLen`, load a byte. If `(token & 128) === 0`, append it to `output`. Otherwise compute `len = ((token >>> 5) & 3) + 3` and `distance = (token & 31) + 1`. Repeat `len` times, reading `output.charCodeAt(written - distance)`, storing that cell at `written`, and incrementing `written`. A valid stream has `1 <= distance <= written` at the start of each match and produces at most 24 cells. Copy forward one cell at a time so a match with length greater than distance can read cells written by the same match. Limiting matches to non-overlapping ranges would simplify copying but would remove this loop-carried dependence.

`roundTrip` calls `compress`, then calls `decompress` with the returned length, and returns the decoded length. Keep the decoded cells in the caller's output buffer so the host can compare them. A checksum would return a convenient scalar but could hide an incorrect cell. Every specified call has valid arguments and capacity. The codec makes no claims about other calls.

## Corpus files and input cases

Create `corpus/projects/lz-roundtrip/main.typed`, `project.json`, `notes.md`, and `scripts/explore.js`. Set the title to “LZ round trip”, group to `Programs`, sources to `["main.typed"]`, pipeline to `speed`, and focus to the decoder's back-reference load once it has a source line. Put the token layout and two runnable examples in the notes. The fresh `explore` script should run the pipeline and compile its result. Run `compress` directly for the packed prefix and `roundTrip` for the decoded prefix and RV32 instruction count, using the 24-A example below with limit 3. The corpus builder already discovers new project directories. [Corpus API](../../../../../../corpus/reference.md), [corpus discovery](../../../../../../tools/corpus.mjs).

Use these entries in `project.json` under `inputs`. The case generator draws each parameter independently.

| Function | Parameters and specs |
| --- | --- |
| `hash3` | `a`, `b`, `c` each `[0, 127]` |
| `compress` | `input` as `{"buffer":[0,24],"cell":[65,66]}`, `packed` as `{"buffer":[24,24],"cell":[0,0]}`, `chainLimit` as `[1,3]` |
| `decompress` | `packed` as `{"cells":[65,224,66,192,127]}`, `packedLen` as `5`, `output` as `{"buffer":[24,24],"cell":[0,0]}` |
| `roundTrip` | The same specs as `compress`, plus `output` with the same spec as its `packed` |

Two characters generate repeated triples and hash collisions at these lengths. Uniform seven-bit text would mostly exercise literals. The decoder's standalone case has literals and overlapping matches and expands to seven A cells, six B cells, and one DEL cell. Random standalone tokens would need dependent inputs to satisfy the distance and output bounds. The fixed fixture uses the existing generator and varied streams still reach the decoder through `roundTrip`. [Case generation](../../../../../../src/typed/evaluate.ts).

### Loader change

Set `"ingest": {"tape": true}` in `project.json`. The browser workbench already honors this field, and `Program` accepts it directly. For Node corpus consumers, type the field as optional `IngestOptions` in `ProjectMeta`, forward it through `Program.fromProject` and pass it to `ingest` from `ingestProject`. This keeps the new project usable through both reference checking and direct parity runs. Passing an option only in the benchmark harness would leave those standard entry points unable to ingest the frame arrays. [Project loader](../../../../../../src/typed/project.ts), [Program](../../../../../../src/typed/program.ts), [browser workbench projects](../../../../../../src/workbench/projects.ts).

A minimal Node probe loaded the vendored front end and reference compiler with `tools/node-vendor.mjs`. With the metadata present, `Program.fromProject` failed with `unknown tape opcode 252 at 9`. Explicit tape ingestion ran both frame arrays, computed indexing, checked buffer reads and writes, scalar calls, `for`, `while`, short-circuit conditions, `break`, and the shifts and masks. The loader generated 40 cases spanning lengths 0–24 and all three limits. The probe passed `speed` checks with zero traps or timeouts, and both RV32 images agreed on all 40 wrapper cases. A separate in-memory workbench project with the metadata opened successfully and returned 7 in 18 RV32 instructions through a fresh project script. These were feature probes. [Lifter](../../../../../../src/typed/lift.ts), [frame array examples](../../../../../../corpus/candela-gallery/kernel.typed).

## Oracle, step budget, and measurement

In a host-side corpus test, save each original input from the case's memory image. For `roundTrip`, require normal completion, returned length equal to the saved length, and exact equality of every decoded cell in that prefix. Run the assertion on the r0 evaluator, the checked `speed` image and the reference image compiled as in `tools/reference-check.mjs`. The original input supplies the expected answer directly, so the test requires no second implementation of the codec. For encoding fixtures, call `compress` directly and compare its returned length and packed prefix. This checks format and match selection independently of the decoder.

- Empty input returns length 0 and emits zero cells. `[0, 127]` emits those two literal bytes.
- Twenty-four A cells emit `[65, 224, 224, 224, 192]` and decode to 24 A cells.
- `AABBAAB` emits seven literals at limit 1. At limit 2 it emits `[65, 65, 66, 66, 131]`. The newer candidate `BAA` collides with `AAB` and the older candidate supplies the match at distance 4.
- Decode the standalone fixture against its exact 14-cell output.

The pass checker counts executed IR statements, including callees, with a limit of 20,000 per case. At most 24 tokens start a search, each visits at most three candidates, and each candidate compares at most six cell pairs. Dictionary insertion runs at most 24 times, and decoding writes exactly `n` cells. As a sizing estimate, allow 120 statements per candidate including loop control, 60 per token outside candidate search, 50 per insertion, 40 per decoded cell, and 200 for setup and returns. This gives 12,440 statements even when charging every work bound at once. Verify the estimate with evaluator `steps` once the source exists. Use length-24 examples with long matches and with collisions. Require zero traps and inconclusives on the full generated suite and inspect per-pass verdicts. Pass checks compare all results and visible memory against r0, so they also catch changes to the encoded stream. [Pass checks and evaluator](../../../../../../src/typed/evaluate.ts), [reference image runner](../../../../../../tools/reference-check.mjs).

Use total emulator instructions over the same 100 seed-7 `roundTrip` cases for r0 with default backend options, `speed` with `chains`, `coalesce`, and `homes`, and the reference image. Record a scalar specialization comparison on the same cases restricted to `chainLimit = 3`. Use a fresh `Program` and bind both `compress.chainLimit` and `roundTrip.chainLimit` to 3 via `Program.specialize` and `BindingsIR`, then run `speed`. The wrapper binding ensures the only internal call passes the same limit. Compare against general `speed` on those fixed-limit cases with the same backend options. A minimal wrapper and callee probe with both scalar bindings applied successfully and had 40 agreements per function. [Specialization API example](../../../../../../tests/typed/specialize.test.mjs).

## Implementation plan

1. Forward the tape ingest option through the Node project paths and verify that the same small frame-array project opens through browser and Node loaders.
2. Implement the Typed functions in the order shown. Use the exact token fixtures and direct decoder call to check the format before running the generated round trip.
3. Add the corpus metadata, notes and fresh script. Run `node tools/parity.mjs lz-roundtrip` and the host-side oracle with both images, then record the instruction totals and the evaluator's maximum case steps.
