---
Title: SHA-256 and ChaCha20 corpus project
Ticket: IRWB-013
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
      Note: Fixed-size Typed frame array examples
    - Path: repo://corpus/reference.md
      Note: Corpus manifest and workbench check APIs
    - Path: repo://src/framework/core/data.ts
      Note: Framework SHA-256 text oracle
    - Path: repo://src/typed/evaluate.ts
      Note: Generated cases and per-pass statement budget
    - Path: repo://src/typed/lift.ts
      Note: Typed integer and memory lowering
    - Path: repo://src/typed/passes.ts
      Note: Checked speed pipeline
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler and emulator comparison
ExternalSources:
    - https://csrc.nist.gov/files/pubs/fips/180-4/final/docs/fips180-4.pdf
    - https://csrc.nist.gov/csrc/media/projects/cryptographic-standards-and-guidelines/documents/examples/sha256.pdf
    - https://www.rfc-editor.org/rfc/rfc8439.html
Summary: Design for two bit-exact integer kernels in one optimization corpus project.
LastUpdated: 2026-11-26T10:34:46.442105445-05:00
WhatFor: ""
WhenToUse: ""
---

# SHA-256 and ChaCha20 corpus project

Put two entry points in one corpus project, `crypto-blocks`. One hashes up to 119 bytes with SHA-256 and the other produces a single IETF ChaCha20 block. SHA-256 gives the compiler a 64-word message schedule, 64 rounds per block, and a runtime table whose contents can be specialized. ChaCha20 keeps 16 working words live through a ten-iteration double-round loop, with additional live inputs and temporaries. Both kernels compute with wrapping 32-bit integers and expose every output byte to the checker.

## Typed interface and memory

```text
sha256(message: buffer, roundK: buffer, out: buffer): i32
chacha20Block(key: buffer, nonce: buffer, counter: i32, sigma: buffer, out: buffer): i32
```

| Buffer | Cells | Layout |
| --- | ---: | --- |
| `message` | 0–119 | One message byte per cell, in order |
| `roundK` | 128 | 64 SHA-256 words, each stored as low u16 then high u16 |
| SHA `out` | 32 | Digest in big-endian word order, one byte per cell |
| `key` | 32 | Eight little-endian ChaCha key words, one byte per cell |
| `nonce` | 12 | Three little-endian nonce words, one byte per cell |
| `sigma` | 16 | ASCII bytes of `expand 32-byte k`, read as four little-endian words |
| ChaCha `out` | 64 | Sixteen little-endian result words, one byte per cell |

At the top of each entry, check the lengths in the table and return `-1` before any output write on a length mismatch. Return `0` after filling the output. The host supplies separate buffers for each argument. Interpret byte inputs with `cell & 255`, so the upper eight bits of a byte cell are immaterial. Use all 16 bits of each `roundK` cell. The counter takes any `i32` bit pattern. Standard algorithm fixtures use the standard table and sigma. Alternate table contents are useful for compiler tests because the entry points consume the bytes they receive.

Use plain `i32` arithmetic for words and parenthesize the bit expressions. Typed emits the signed or unsigned shift according to the operator, so use `>>>` for zero-fill. Write small `rotr(x, n)` and `rotl(x, n)` helpers with the respective expressions `(x >>> n) | (x << (32 - n))` and `(x << n) | (x >>> (32 - n))`. Both use the low five bits of the shift count. Factor out `readLE32(bytes, at)`, `writeBE32(out, at, word)` and `writeLE32(out, at, word)`. Readers shift four masked cells into place and OR them together. Writers extract four bytes using zero-fill right shifts and `& 255` in the named byte order. The writers return `0` and the entry calls discard that result.

The [vendored frontend](../../../../../../vendor/ds-js-os/compiler/typed/typed-wasm.js) parses integer bit operations, buffer methods and literal-sized function-local arrays. [The lifter](../../../../../../src/typed/lift.ts) maps `i32.shr_u` to `shru`, uses checked addresses and loads or stores for buffer cells, and lifts frame arrays with `array.address` and `array.zero`. See [sort](../../../../../../corpus/projects/sort/main.typed) for mutable buffers and the [Candela kernel](../../../../../../corpus/candela-gallery/kernel.typed) for indexed `Int32Array` loads and stores inside loops. Keep all helper signatures scalar or buffer-based so the stock reference runner can call them as independent functions.

### SHA-256

Keep eight chaining words `h0…h7` as locals, initialized with the SHA-256 IV from FIPS 180-4 §5.3.3. Allocate one `new Int32Array(64)` schedule (256 bytes) in the entry and reuse it for each block. Use one block for lengths 0–55 and two for 56–119. The outer loop advances by 64 bytes. For the first 16 schedule words, walk four byte positions per word and build it big-endian. At absolute position `p`, take the masked message byte for `p < n`, use `0x80` for `p === n`, and use zero otherwise except for the final two positions of the padded message. Those carry `(n * 8) >>> 8` and `(n * 8) & 255`, respectively. The upper six bytes of the standard eight-byte length field are zero at this size. Every block overwrites all 64 schedule slots before the compression loop reads them.

For `t = 16…63`, compute `W[t] = W[t-16] + small0(W[t-15]) + W[t-7] + small1(W[t-2])`. The small sigma functions XOR right rotations by `(7, 18)` and `(17, 19)` with logical right shifts by 3 and 10, respectively. Keep the sigma expressions in the loops, with the rotations as helper calls. Copy the chaining words to working locals `a…h` before the round loop. At each of the 64 rounds, assemble `k = roundK.charCodeAt(2*t) | (roundK.charCodeAt(2*t+1) << 16)` and compute:

```text
big0(a) = rotr(a, 2) XOR rotr(a, 13) XOR rotr(a, 22)
big1(e) = rotr(e, 6) XOR rotr(e, 11) XOR rotr(e, 25)
choose  = (e AND f) XOR ((NOT e) AND g)
major   = (a AND b) XOR (a AND c) XOR (b AND c)
t1      = h + big1(e) + choose + k + W[t]
t2      = big0(a) + major
(a, b, c, d, e, f, g, h) <- (t1+t2, a, b, c, d+t1, e, f, g)
```

Write the parallel update as ordinary assignments in reverse dependency order, starting with `h = g` and ending with `a = t1 + t2`. After each block, add the eight working words back into their corresponding chaining words. After the last block, write the eight chaining words in order. The digest uses the incoming chaining words in both initialization and feed-forward, which also creates live values across the round loop. [FIPS 180-4 §§4.1.2, 4.2.2, 5 and 6.2](https://csrc.nist.gov/files/pubs/fips/180-4/final/docs/fips180-4.pdf).

### ChaCha20

Initialize scalar locals `x0…x15` with four words from `sigma`, eight words from `key`, the counter, and three words from `nonce`, in that order. Save the originals in one `new Int32Array(16)` (64 bytes) for feed-forward. Keep the working values in locals through the loop. This leaves the original words available at the end while putting the working set under register pressure throughout.

Write the eight quarter-round sites explicitly inside one loop that runs ten times. At each site substitute the four named scalar locals into the following sequence, using `rotl` at each rotation.

```text
a = a + b    d = rotl(d XOR a, 16)
c = c + d    b = rotl(b XOR c, 12)
a = a + b    d = rotl(d XOR a,  8)
c = c + d    b = rotl(b XOR c,  7)
```

The four column sites use `(0,4,8,12)`, `(1,5,9,13)`, `(2,6,10,14)`, `(3,7,11,15)`. The four diagonal sites follow with `(0,5,10,15)`, `(1,6,11,12)`, `(2,7,8,13)`, `(3,4,9,14)`. This keeps all 20 rounds in a source loop and makes the scalar dataflow visible. Afterwards, for each named local `xi`, write `xi + initial[i]` little-endian at offset `4*i`. The counter is used once as supplied. [RFC 8439 §§2.1–2.3](https://www.rfc-editor.org/rfc/rfc8439.html#section-2.3).

## Optimizations to investigate

| Ticket | Experiment |
| --- | --- |
| IRWB-003 | Run `speed` with checks on. Inspect whether inlining exposes fixed shift counts and removes calls in the inner loops, rotation reduces loop overhead, and coalescing reduces copies in the SHA state updates. Measure whether `homes` pays for repeated large immediates, especially once table values are exposed. Sweep register budgets on ChaCha and inspect real spill traffic and callee saves. |
| IRWB-006 | Use verified rule tables to simplify integer expressions and an SSA view to follow the loop-carried state. Inspect copy chains and opportunities exposed when a helper's immediate arguments become visible. |
| IRWB-007 | With the same Typed source, specialize on the standard `roundK` and `sigma` bytes and their lengths. Keep message, key, nonce and counter dynamic. Partial SHA round-loop unrolling exposes particular indices and their constants. Compare specialization with and without unrolling to measure the cost in image bytes and temporary live ranges. |
| IRWB-008 | Validate local bitvector rewrite instances exactly where supported. Keep differential checks on the full kernels and their memory effects. Rotate, carry and byte-order mistakes must produce exact mismatches. |
| IRWB-010 | Search for profitable equivalent forms of rotate idioms and SHA Boolean expressions in short arithmetic windows. Cost the resulting sequences on RV32IMF, where a rotate takes a sequence of base instructions. For example, a search might reuse a shifted intermediate or find the equivalent choice expression `g ^ (e & (f ^ g))`. A rotate representation in an analysis or search still needs legal RV32IMF lowering. |
| IRWB-011 | Use this project as a bit-exact control for work on tolerance contracts. A one-bit output difference must fail the integer check. |

Start with loops and the ordinary helper expressions above. Leave unrolling, interleaving, algebraic rewrites and register assignment to the compiler experiments. If a ceiling is needed later, make a separate hand-tuned project with identical host inputs and outputs, using options such as partial unrolling or a rolling SHA schedule. Report it as a separate source baseline.

For specialization, a fixed `cells` generator setting says what the test harness supplies. The optimization still needs a precondition on the table bytes, lengths and their read-only status for the invocation. A specialized image may be called under that explicit precondition, or a dispatcher may check it and use the general path otherwise. Keep both measurements on identical standard fixtures and show that the general image handles at least one alternate table and sigma. For local bitvector rewrites, include rotate counts 0 and 32 in direct tests. The two shift counts both mask to zero there, so replacing the OR with XOR requires proof that excludes those counts.

## Generated cases and evaluator budget

Create `corpus/projects/crypto-blocks/` with `main.typed`, `project.json`, `notes.md`, `scripts/vectors.js` and `scripts/measure.js`. Set the project title to `SHA-256 and ChaCha20`, group to `Programs`, sources to `["main.typed"]`, and pipeline to `speed`. Set `focus` to the source line of a SHA round rotation call once the source is stable. Use `notes.md` to identify the block loops, the byte encodings and an example of inspecting spills or rotation provenance. Mark the measurement script `fresh` in project metadata so each run starts at r0. [Workbench project and check APIs](../../../../../../corpus/reference.md).

Use the following specifications under `inputs`, keyed first by function and then by parameter name. For SHA `roundK`, put `{ "cells": [...] }` in the actual JSON with all 128 literal cells. Generate that list once from the 64 FIPS §4.2.2 hex words in order, emitting `word & 65535` followed by `(word >>> 16) & 65535` for each. Freeze the expanded data in the manifest so case generation has no host dependency.

| Function | Parameter specifications |
| --- | --- |
| `sha256` | `message` `{"buffer":[0,119],"cell":[0,255]}`, `roundK` fixed cells as above, `out` `{"buffer":[32,32],"cell":[256,65535]}` |
| `chacha20Block` | `key` `{"buffer":[32,32],"cell":[0,255]}`, `nonce` `{"buffer":[12,12],"cell":[0,255]}`, `counter` `[-2147483648,2147483647]`, `sigma` `{"cells":[101,120,112,97,110,100,32,51,50,45,98,121,116,101,32,107]}`, `out` `{"buffer":[64,64],"cell":[256,65535]}` |
| `rotr`, `rotl` | `x` `[-2147483648,2147483647]`, `n` `[0,31]` |
| `readLE32` | `bytes` `{"buffer":[32,32],"cell":[0,65535]}`, `at` `[0,28]` |
| `writeBE32`, `writeLE32` | `out` `{"buffer":[64,64],"cell":[256,65535]}`, `at` `[0,60]`, `word` `[-2147483648,2147483647]` |

The default pass contract checks every function in an ordinary project. Explicit helper specs keep the generated arguments in bounds. Output sentinels make a missed byte store observable. `oneOf` in `makeValue` selects a scalar, so use explicit calls for whole-buffer fixtures and SHA boundary lengths. For the alternate-data experiment, clone the manifest in memory with `roundK` generated as 128 cells in `[0,65535]` and `sigma` as 16 cells in `[0,255]` for a separate seed-controlled general run. [Case generation and the meaning contract](../../../../../../src/typed/evaluate.ts).

The limit in `meaningKept` is **20,000 executed IR statements per call**, shared with every helper reached from that call. Expressions within a statement are evaluated without adding separately to the counter. The following worksheet reserves space for lowered branch and call bookkeeping. These are planning estimates. Inspect the actual emitted statements and update the totals during implementation.

| Entry | Planning allowance | Estimated statements |
| --- | --- | ---: |
| SHA, two padded blocks | Per block, 64 padded bytes × 18, 48 expansion iterations × 20, 64 rounds × 46 including rotate calls, plus 80 for setup and feed-forward. Allow another 500 per call for guards, array initialization and digest stores. | 10,772 |
| ChaCha, one block | 80 quarter rounds × 32 including rotate calls, plus 320 for loop control and 750 for setup and serialization. | 3,630 |

Run explicit evaluator cases with a 20,000 limit and collect statement counts at r0 and across the pipeline. Use all SHA lengths 0–119 at least once, with particular attention to 55/56, 63/64 and 119. Require no limits or traps on valid cases and target a maximum of 15,000 steps across the checked revisions. Inspect statement counts and simplify padding or helper scaffolding if the design exceeds that target. Keep the default pass limit and preserve all rounds. Record disagreements, rejections and inconclusives separately. An inconclusive case supplies no evidence of agreement.

## Correctness gates

1. **Published known answers.** Check all 32 digest bytes for NIST's `abc` and the 56-byte ASCII sample `abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq`. Their digests are `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` and `248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1`. For ChaCha, use RFC 8439 §2.3.2 with key bytes 0 through 31, nonce hex `000000090000004a00000000`, and counter 1. Compare the 64 serialized bytes beginning `10f1e7e4`. Add the block-function vectors from Appendix A.1, including the zero key, nonce and counter. Use the RFC's serialized bytes or independently serialize its expected words with host `DataView`. [NIST SHA-256 worked examples](https://csrc.nist.gov/csrc/media/projects/cryptographic-standards-and-guidelines/documents/examples/sha256.pdf), [RFC 8439 §2.3.2](https://www.rfc-editor.org/rfc/rfc8439.html#section-2.3.2), [RFC 8439 Appendix A.1](https://www.rfc-editor.org/rfc/rfc8439.html#appendix-A.1).
2. **Independent SHA implementation.** Use `sha256(text)` from [framework data.ts](../../../../../../src/framework/core/data.ts) for empty, ASCII and additional deterministic text cases. Pass `TextEncoder.encode(text)` bytes to Typed. The framework wrapper hashes UTF-8 and can delegate to Node crypto. For a genuinely separate portable path, use `new Sha256().update(text).digest()` from [framework sha256.ts](../../../../../../src/framework/core/sha256.ts). For arbitrary generated byte arrays, use Node's `createHash('sha256').update(Uint8Array.from(bytes)).digest('hex')` in the host test. A JavaScript string constructed from arbitrary byte values can change their encoding. For byte-cell tests with high bits set, mask to eight bits at the oracle boundary. See the known answers first so the fixture reader and digest serializer are anchored to published bytes.
3. **Output and memory.** Start each run with freshly initialized guest memory. For a valid call require status 0, all output cells equal to the expected octets, and unchanged buffer lengths and input cells. For explicit wrong-length cases (SHA 120 bytes, short K, short output, and wrong lengths for ChaCha key, nonce, sigma and output) require status -1 and unchanged guest memory. Add explicit all-zero, all-`0xff`, ascending and alternating-byte payloads. Include counter bit patterns 0, 1, `0x80000000` and `0xffffffff`, using signed `i32` arguments. The workbench run summary displays up to 64 cells per buffer, so use raw `RunResult.bytes` with `MemoryItem` offsets for full input and memory checks, including all of `roundK`.
4. **Compiler agreement.** Run the r0 evaluator and both compiler images on the published fixtures. Use the [reference checker](../../../../../../tools/reference-check.mjs) pattern for generated cases: compile the source with the vendored reference compiler, wrap its image, and run it with the same case arguments and memory on the emulator. Check r0 against the reference image, then the workbench's own r0 and optimized images against their evaluator counterparts. Run `O2` and `speed` with their per-pass checks and repeat the final check with 100 cases per function at seeds 7 and 29. Require full agreement with zero inconclusives and zero faults. The reference comparison tests compilation and lowering. The published vectors and host SHA implementations independently test the intended algorithm. To extend known-answer coverage to generated ChaCha inputs, use a small host reference with an indexed 16-word state and DataView serialization. First validate it against the RFC, then use it for counter edge cases and alternate sigma bytes. Add a negative control by flipping one expected output bit and confirming the comparison fails.

## Measurement and implementation order

Implement `scripts/measure.js` with the same explicit arguments and fresh output buffers at every revision and backend configuration. Use image runs (`img.run` or `runImage`) and record successful emulator `steps` in instructions. Start with workbench r0, O2 and speed using identical default backend options. Then hold the speed revision fixed and vary `chains`, `coalesce` and `homes`, individually and together. Sweep default, 16 and 8 allocation registers on ChaCha20 to see where spills start. Use reference compiler instruction counts as another baseline. Include image bytes, frame sizes, spill information and hot instruction counts for the schedule, rounds, and output sites. [Backend options](../../../../../../src/typed/backend/options.ts), [emulator run contract](../../../../../../src/typed/backend/run.ts).

Report SHA instructions per message byte for fixed nonempty lengths 55, 56, 64 and 119. Also report instructions per padded block byte (`steps / (64 * blockCount)`) and raw instructions, including for the empty case. For ChaCha20 report `steps / 64` instructions per generated keystream byte. The ratios include entry overhead, feed-forward and serialization. Record the revision, options, fixture, raw numerator and denominator for every row. Use the same denominators for a specialized build and any hand-tuned ceiling. If a specialization dispatcher is measured, include its instructions and report the preconditioned variant as its own result.

1. Implement buffer guards, shifts and serialization helpers. Compile them through the workbench and reference paths and directly test wraparound, shift counts and endian handling.
2. Implement SHA padding, expansion and compression. Check the publication fixtures and the framework SHA before introducing optimization.
3. Implement the ChaCha double-round loop and verify the RFC blocks. Inspect liveness around the loop to confirm that the sixteen working values survive as scalar locals.
4. Wire the manifest and workbench scripts. Add the independent host checks using the repository's [Typed test setup](../../../../../../tools/node-vendor.mjs). Establish r0 and per-revision step headroom, full-memory agreement, and agreement with both image paths.
5. Record a baseline measurement table from identical validated cases. Use it for the specialization, rule discovery and allocation experiments as those mechanisms become available.
