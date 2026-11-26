---
Title: SHA-256 and ChaCha20 corpus design
Ticket: IRWB-013
Status: complete
Topics:
    - compiler
    - ir
    - performance
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://corpus/reference.md
      Note: Project schema, input specifications, and workbench image APIs
    - Path: repo://src/framework/core/data.ts
      Note: Independent text-based SHA-256 oracle
    - Path: repo://src/typed/evaluate.ts
      Note: Generated cases, guest memory, and the pass step limit
    - Path: repo://src/typed/lift.ts
      Note: Tape ingestion, frame arrays, and shift lowering
    - Path: repo://src/typed/passes.ts
      Note: Checked optimization pipelines and speed configuration
    - Path: repo://src/typed/project.ts
      Note: Headless project metadata and ingestion integration
    - Path: repo://tools/reference-check.mjs
      Note: RV32 reference comparison and emulator runner
ExternalSources: []
Summary: Design for a bounded SHA-256 and ChaCha20 workload with full-output oracles and RV32 instructions-per-byte measurements.
LastUpdated: 2026-11-26T12:00:37.441793552-05:00
WhatFor: ""
WhenToUse: ""
---

# SHA-256 and ChaCha20 corpus design

Build one project, `sha256-chacha20`, with two independently runnable kernels. SHA-256 exercises a message schedule, a sequential 64-round loop, a table of externally supplied constants, and copies between eight working words. ChaCha20 keeps 16 working words live across a loop of ten double rounds. Both expose shift/OR rotates, and both write their entire output into guest memory so a change to any output bit can fail a check. Report emulator instructions per byte for each kernel.

## Supported calls and memory

All words are Typed `i32` bit patterns. Addition wraps modulo 2³². Use `>>>` for zero-fill shifts, `<<` for left shifts, and ordinary bitwise operators. All source array sizes are compile-time literals. The kernels are iterative and take separate, non-overlapping buffers. One byte occupies one u16 cell in a byte buffer, in the range 0–255. Each output buffer has the exact length below and may initially contain any u16 cells. A successful call returns `0` and overwrites every output cell while leaving the other buffers untouched.

| Entry | Input | Configuration | Output |
| --- | --- | --- | --- |
| `sha256(msg: buffer, k: buffer, out: buffer): i32` | 0–119 bytes, length from `msg.length` | 128 u16 cells holding 64 round words. Word `i` has its low half at `2*i`, high half at `2*i+1`. | 32 digest bytes in big-endian word order |
| `chacha20(input: buffer, constants: buffer, out: buffer): i32` | 48 bytes. Key at 0–31, 32-bit counter at 32–35, 96-bit nonce at 36–47. | Eight u16 cells in the same low-half-first format for the four initial constant words. | 64 block bytes in little-endian word order |

For standard outputs, use the SHA-256 round words from FIPS 180-4 §4.2.2 and ChaCha20 words `61707865 3320646e 79622d32 6b206574` in that order. Both entries also accept all bit patterns in their configuration words. Those cases run the same computation with replacement constants and serve as differential cases. The standard-algorithm oracles apply when the constants are canonical.

One block would cover SHA’s compression core. Allowing up to 119 bytes also tests the transition at 56 bytes, state chaining and schedule reuse, with a maximum of two blocks. ChaCha’s one-block entry covers the full round function and feed-forward. Streaming, encryption of a payload, and authentication would add behavior outside this benchmark.

Passing result and configuration buffers uses the corpus convention in `histogram` and `sort`. It gives the existing checker visibility into every output word. Returning a scalar checksum would allow some incorrect outputs to agree. Pass the constant words as input so the same source retains runtime loads in the general experiment and can later be specialized under a restricted contract. Embedding tables in Typed would make that comparison unavailable. Keeping data and configuration separate allows the tests to vary either independently.

## Typed program

### Shared helpers

Use ordinary calls to small helpers so the `inline` pass has work to do. Signatures below also define the parameter names used in the input specifications.

- `rotr(x: i32, n: i32): i32` computes `(x >>> n) | (x << (32 - n))`. `rotl(x: i32, n: i32): i32` computes `(x << n) | (x >>> (32 - n))`. The workload uses counts 1–31.
- `readPair(b: buffer, i: i32): i32` combines the two u16 cells as `b.charCodeAt(2*i) | (b.charCodeAt(2*i+1) << 16)`. Both cells are present.
- `readLE(b: buffer, offset: i32): i32` combines four byte cells as `b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)`.
- `writeLE(out: buffer, offset: i32, word: i32): i32` writes the four cells with shifts 0, 8, 16 and 24, each masked with 255, and returns 0. For the two little-endian helpers the four addressed cells are present.

The four explicit reads and writes make the byte order visible at each call. Buffer cells use `charCodeAt` and `setCharCodeAt`. Frame arrays use bracket indexing. The vendored front end accepts full-width hex words. In `src/typed/lift.ts`, `BINOPS` maps shifts and bitwise operators into `typed.blocks`, and the tape path lifts frame-array address, zeroing, load and store operations. `src/typed/evaluate.ts` implements wrapping addition and masks shift counts with 31. Examples for text buffers and mutation are in `corpus/projects/{checksum,histogram,sort}/main.typed`. The fixed-size frame arrays follow `corpus/candela-gallery/kernel.typed`.

A small Node 24.18 probe lifted fixed arrays, buffer reads and writes, helper calls, high-bit literals and a complementary shift. Tape ingestion succeeded and a known result matched both RV32 images. A second probe exercised all three proposed frame sizes together, with byte packing, unsigned shifts, XOR and an output-writing helper. The evaluator and both images agreed on ten generated cases per probe function. These probes establish the language path. Kernel instruction and statement counts will come from the implemented project.

### SHA-256

Allocate `pad = new Int32Array(128)`, `w = new Int32Array(64)`, and `h = new Int32Array(8)` once per call, for 800 frame-array bytes before compiler temporaries and spills. Copy message bytes into `pad`, append `0x80`, and put the bit length in the last two bytes of the padded span, high byte first. The preceding six length bytes and the unused padding come from zero initialization. Use a 64-byte span for messages of length at most 55, otherwise 128 bytes. Initialize `h` with the eight IV words from FIPS 180-4 §5.3.3.

For each 64-byte padded block, assemble `w[0..15]` from four bytes each, big-endian. Expand the remaining words with the usual recurrence. In the pseudocode, `+32` denotes wrapping addition, `ROR` calls `rotr`, and `SHR` is logical right shift.

```text
small0(x) = ROR(x, 7) xor ROR(x, 18) xor SHR(x, 3)
small1(x) = ROR(x, 17) xor ROR(x, 19) xor SHR(x, 10)
w[t] = w[t-16] +32 small0(w[t-15]) +32 w[t-7] +32 small1(w[t-2])
```

Seed scalar locals `a` through `hWord` from the eight state words. Repeat the following for `t = 0..63`, reading `K[t]` through `readPair(k, t)`. Use `e ^ -1` for the bitwise complement.

```text
big0(a) = ROR(a, 2) xor ROR(a, 13) xor ROR(a, 22)
big1(e) = ROR(e, 6) xor ROR(e, 11) xor ROR(e, 25)
choose = (e & f) xor ((e xor -1) & g)
majority = (a & b) xor (a & c) xor (b & c)
t1 = hWord +32 big1(e) +32 choose +32 K[t] +32 w[t]
t2 = big0(a) +32 majority
(a,b,c,d,e,f,g,hWord) = (t1 +32 t2, a, b, c, d +32 t1, e, f, g)
```

Use assignments in reverse destination order, starting with `hWord = g` and ending with `a = t1 + t2`, so the old values are available when read. After each block add the working locals into the corresponding `h` cells. Serialize the final eight state words at output offsets `4*i` with shifts 24, 16, 8 and 0 and a mask of 255 per byte. A 64-word schedule directly follows the algorithm and exposes scheduled loads and stores. A 16-word ring adds index arithmetic and belongs in a separate ceiling experiment.

### ChaCha20

Read the four configuration words into `x0..x3`. Read the 12 input words with `readLE(input, 4*i)` into `x4..x15`. Use 16 scalar working locals, initialized before the double-round loop. An indexed state array and an indexed quarter-round helper would be shorter, but would put the working set in memory and hide the intended register pressure. Spell the fixed quarter-round schedule with 16 named locals and a shared rotate helper.

A quarter round updates the four selected locals in this order, with the current value of each local feeding the next line.

```text
a = a +32 b    d = ROTL(d xor a, 16)
c = c +32 d    b = ROTL(b xor c, 12)
a = a +32 b    d = ROTL(d xor a, 8)
c = c +32 d    b = ROTL(b xor c, 7)
```

In each of ten double rounds, run columns `(0,4,8,12)`, `(1,5,9,13)`, `(2,6,10,14)`, `(3,7,11,15)` and then diagonals `(0,5,10,15)`, `(1,6,11,12)`, `(2,7,8,13)`, `(3,4,9,14)`. Annotate each group in source so its indexing is reviewable. The fixed eight groups express one double round. Keep all ten iterations in the loop.

After the loop, add each working word to its corresponding original word and write it through `writeLE` at offset `4*i`. Re-read original words from the input buffers for feed-forward instead of reserving a second set of 16 live locals. This keeps pressure attributable to the working state. The four configuration reads and 12 input reads at the end are part of the measured entry.

## Project and generated cases

Place `main.typed`, `project.json`, `notes.md`, `vectors.json` and `scripts/explore.js` in `corpus/projects/sha256-chacha20/`. Put both entries and their helpers in `main.typed`. Put the standard configuration words and known answers in `vectors.json`, using hex strings for readability and converting each configuration word to low then high u16 cells in the host. Explain the two entry points, measurement denominators and inspection steps in `notes.md`. Set the metadata as follows, with `focus` adjusted to the first ChaCha quarter round after laying out the file.

```json
{
  "title": "SHA-256 and ChaCha20",
  "about": "Integer rotates, round constants and 16 live state words.",
  "group": "Programs",
  "sources": ["main.typed"],
  "ingest": { "tape": true },
  "pipeline": "speed",
  "scripts": {
    "explore": { "about": "Run a known-answer check and compare RV32 instruction counts.", "fresh": true }
  },
  "inputs": {
    "sha256": {
      "msg": { "buffer": [0, 119], "cell": [0, 255] },
      "k": { "buffer": [128, 128], "cell": [0, 65535] },
      "out": { "buffer": [32, 32], "cell": [0, 65535] }
    },
    "chacha20": {
      "input": { "buffer": [48, 48], "cell": [0, 255] },
      "constants": { "buffer": [8, 8], "cell": [0, 65535] },
      "out": { "buffer": [64, 64], "cell": [0, 65535] }
    },
    "rotr": { "x": [-2147483648, 2147483647], "n": [1, 31] },
    "rotl": { "x": [-2147483648, 2147483647], "n": [1, 31] },
    "readPair": { "b": { "buffer": [128, 128], "cell": [0, 65535] }, "i": [0, 63] },
    "readLE": { "b": { "buffer": [48, 48], "cell": [0, 255] }, "offset": [0, 44] },
    "writeLE": {
      "out": { "buffer": [64, 64], "cell": [0, 65535] },
      "offset": [0, 60],
      "word": [-2147483648, 2147483647]
    }
  }
}
```

The project gate takes independent per-parameter specifications and checks each helper as an entry too. Fixed buffer capacities and offset ranges keep those calls in domain. Run a second cohort with `{ "cells": [...] }` for each standard configuration and keep the data inputs variable. These fixed cases are tests of the standard configurations. Case generation alone establishes no compiler fact about the buffers.

The browser opens tape projects through `kernelFor` in `src/workbench/projects.ts` and `tools/corpus.mjs` discovers new project directories automatically. Add the id to `corpus/projects/index.json` only to place it deliberately in the browser order. The default inspection ingestion failed on the array probe with `unknown tape opcode 252 at 9`. `Program.fromProject` and `ingestProject` currently disregard the tape metadata. The small integration change is to type optional `ProjectMeta.ingest` as `IngestOptions` and forward it from both helpers. That makes bulk tools, including `tools/reference-check.mjs`, reach the same ingestion path as the browser. Before that change, the existing headless path is `new Program(ps.name, ps.source, { inputs: ps.meta.inputs, ingest: { tape: true } })`. Use the existing tape option instead of adding another source or replacing frame arrays with guest scratch buffers just for ingestion.

## Step budget

`evaluate` counts executed IR statements, including statements in callees. Tree operations inside a statement contribute to RV32 instructions but do not each consume an evaluator step. The pass gate defaults to 40 cases per function, seed 7, with a 20,000-statement limit per case. A limit hit is inconclusive. The implementation must show zero inconclusives and zero traps on supported cases, even if the gate would accept on other decided cases.

Budget about 15,000 statements for worst-case SHA and 5,000 for ChaCha. These are planning allowances, not measurements. For SHA, allow 30 per copied byte (round up to 128 bytes), 20 per packed word (32), 30 per expanded word (96), 45 per compression iteration (128) including helper calls, 20 per output byte (32), and about 512 for initialization, feed-forward and loop boundaries. For ChaCha, allow 12 assignments and up to four six-statement rotate calls per quarter round (80 quarter rounds), plus 2,000 for the loop, initialization, re-reads and stores. Measure the per-case maxima at r0 and on each changed O2 and `speed` revision with the gate’s actual limit. Include forced SHA lengths 55, 56 and 119 and use a 16,000-statement implementation target to leave headroom for additional checked passes. If the target is missed, use statement counts and hot blocks to find repeated setup or helper overhead before reconsidering the 119-byte cap.

## Oracles and acceptance

Known-answer tests compare every output cell. Use FIPS 180-4 for the SHA constants and padding rules, NIST’s SHA-256 examples for message fixtures, and RFC 8439 §2.3.2 for the ChaCha block fixture. The following values were also reproduced locally with Node crypto.

| Case | Expected serialized bytes in hex |
| --- | --- |
| SHA-256 empty | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| SHA-256 `abc` | `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` |
| SHA-256 `abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq` (56 bytes) | `248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1` |
| ChaCha20 key bytes 0 through 31, counter 1, nonce hex `000000090000004a00000000` | `10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4ed2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e` |

Use `sha256(text)` from `src/framework/core/data.ts` as the second SHA implementation for generated ASCII inputs. Construct one character per input byte for that cohort so UTF-8 encoding preserves the bytes. The framework function hashes UTF-8 text. For arbitrary generated bytes with standard constants, use Node’s `createHash('sha256').update(Buffer.from(bytes))` directly. In Node the framework also delegates to Node crypto, so these two entry paths are one implementation there. Node crypto is independent of the Typed kernel. Published expected bytes provide an additional fixed check. Use the ChaCha vector for algorithm correctness and the generated cases below for compiler correctness.

1. For the known answers, run r0, the optimized evaluator and both RV32 compilers. Use a recognizable nonzero output fill, require the result to be 0, and compare every byte plus the rest of initial guest memory. At the low-level interface take the same initial image from `benchCase`, patch only the expected u16 output cells in a copy, and compare the guest prefix. Compare byte values exactly, without masking returned u16 cells. A nonzero high byte in an output cell is a mismatch.
2. Run the checked pipelines against r0 with the general metadata, then with standard configuration cases, using seeds 7 and 31. Add deterministic SHA cases at lengths 0, 1, 55, 56, 63, 64 and 119 with a mix of ASCII, all-ones bytes and nonrepeating bytes. Exercise ChaCha with zero, mixed and all-ones data, including counters 0 and `0xffffffff`; each call emits one block. Run the generated corpus cross-check with the same inputs against the reference compiler’s RV32 image and the workbench RV32 images. Follow `tools/reference-check.mjs` for vendor loading and `runImage`; its printed totals are a report, so assert no mismatch, trap or limit hit in the focused Node test.
3. Check that changing a rotate count, replacing logical with arithmetic shift, or omitting one output store creates a disagreement on a known answer or generated case. Run these negative controls on scratch programs. Require matching results and memory before reporting performance.

## Measurements and optimizer use

Run the same known-answer and deterministic standard fixtures on r0, O2, `speed` with default backend options, `speed` with each of `chains`, `coalesce` and `homes` and with all three, and the reference compiler. The browser script can use `p.compile({ rev: 'r0' })` and image `run` on the same fixture args. The headless test can use `lowerToImage` and `runImage` on each revision. Use fresh r0 for each pipeline. Report image revision and options, function bytes, frame size, spills, instructions, and instructions per byte. Inspect the IR diffs and emitted code so an instruction-count change can be tied to a specific transformation.

- For SHA, divide entry instructions by logical message bytes and report one row for each representative length. Show raw instructions for the empty case. Also divide by padded bytes (64 or 128) to expose the cost of compression across the padding boundary. Include entry setup, padding and digest stores for both metrics.
- For ChaCha, divide by 64 emitted bytes. Include decoding, feed-forward and serialization. On the same revision, sweep register budgets `8`, `16`, and `'all'`. Compare peak live working words across the loop, static spills and dynamic instructions. An array-based implementation would mainly measure explicit state loads and stores.
- For IRWB-003, look for helper inlining and immediate shift counts, a cheaper loop back edge, fewer copies among state locals, and any constants that `homes` actually chooses. A gain from `homes` is a measurement question because the round-table values are loaded from memory. For IRWB-006, inspect loop-carried state in the SSA view and use the shift/OR and Boolean `choose` and `majority` trees as candidates for verified rule tables.
- For IRWB-008, preserve before/after values and their provenance for any rule experiment. The pipeline today uses generated cases. Exact edit validation would independently derive covered edits and leave structural changes such as unrolling to the appropriate residual check. IRWB-011’s float-tolerance work has no role in the result comparison because every integer bit is observable.
- For IRWB-010, start with complementary shifts in both operand orders and the SHA Boolean trees for rule discovery, equality saturation, or a small superoptimization window. Compare the cost after instruction selection. RV32IMF has no rotate instruction, so recognizing a rotate does not imply a single machine instruction. Verify the 32-bit masked-count semantics and test the high-bit words that distinguish `shr` from `shru`.

For the IRWB-007 experiment, hold `k` and `constants` fixed to their standard cells while messages, keys, counters and nonces remain variable. Use identical concrete cases for measuring the general image and a future specialized image and label the restricted contract. In the general image, a changed configuration must still influence the output. Once immutable-buffer facts are supported, constant-index ChaCha loads are early candidates. SHA’s `K[t]` needs known iteration indices as well, so try a small unroll or partial-evaluation factor and charge code-size growth and spills against the gain. A fully unrolled source baseline would hide that trade-off.

## Implementation order

1. Write the helpers and SHA entry. Ingest through the existing tape path, run the known answers and several length boundaries, then record worst-case statement counts for the actual IR.
2. Add the ChaCha entry, verify the RFC fixture in all engines and inspect liveness and spills. Then freeze the two configuration layouts and fixture bytes.
3. Add the project files and the focused Node assertions. Forward tape metadata in the two headless project loaders for corpus discovery and run both modes of the reference cross-check. Confirm that opening the browser project and running its fresh script reproduce the known-answer and measurement rows.
4. Collect the O2 and `speed` baselines and register sweep after correctness checks. Record raw counts, denominators and backend settings in project notes so future tickets can repeat the comparison.

## Later

- Immutable-buffer specialization and SHA table-load folding depend on constant-memory facts beyond the scalar and record-field bindings in `src/typed/specialize.ts`.
- Full-round or partial unrolling and a separate hand-tuned ceiling project can follow once baseline size and spill costs are recorded.
- Search-driven rotate/Boolean rewrites and exact acceptance of discovered edits depend on the IRWB-010 and IRWB-008 infrastructure.
