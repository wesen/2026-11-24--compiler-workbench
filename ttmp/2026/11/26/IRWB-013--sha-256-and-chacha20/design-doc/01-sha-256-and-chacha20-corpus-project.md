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

Build one project, `crypto-blocks`, with a one-block SHA-256 hash for messages of 0–55 bytes and the IETF ChaCha20 block function. SHA supplies a 64-word schedule and a runtime round table. ChaCha keeps 16 scalar words live through a double-round loop. Keep the loops and straightforward arithmetic so the compiler has work to do.

## Interface and Typed code

```text
sha256(message: buffer, roundK: buffer, out: buffer): i32
chacha20Block(key: buffer, nonce: buffer, counter: i32, out: buffer): i32
```

Callers supply disjoint buffers. Message, key and nonce use one byte per u16 cell and lengths 0–55, 32 and 12 respectively. The 128-cell `roundK` contains the 64 FIPS words as low half then high half. SHA writes 32 big-endian digest bytes and ChaCha writes 64 little-endian bytes, each into an exactly sized output buffer. Both entries return 0 after writing. The corpus harness supplies these lengths and byte values.

Use wrapping `i32` arithmetic, `>>>` for logical shifts, and small `rotr(x, n)` and `rotl(x, n)` helpers with `(x >>> n) | (x << (32 - n))` and `(x << n) | (x >>> (32 - n))` respectively. Keep scalar and buffer signatures so the reference runner can call every function. Use `readLE32(bytes, at)` to assemble four cells with shifts and OR, and `writeBE32(out, at, word)` and `writeLE32(out, at, word)` to store four bytes with shifts and `& 255`. Both writers return 0. The lifter supports logical shifts and buffer operations, and Candela shows indexed function-local arrays. [Typed lifter](../../../../../../src/typed/lift.ts), [Candela kernel](../../../../../../corpus/candela-gallery/kernel.typed).

### SHA-256

Use one `new Int32Array(64)` schedule (256 bytes). For words 0–13, pack four consecutive positions big-endian. Each position contributes its message byte if it is before `message.length`, `0x80` if equal, or zero if after. Set word 14 to zero and word 15 to `message.length * 8`. This fills the single padded block, with room for the full 64-bit length field.

Expand words 16–63 with `W[t-16] + small0(W[t-15]) + W[t-7] + small1(W[t-2])`. The two small sigmas XOR right rotations by `(7,18)` and `(17,19)` with logical right shifts by 3 and 10 respectively. Initialize locals `a…h` from the FIPS IV. In a 64-iteration loop, load `k = roundK.charCodeAt(2*t) | (roundK.charCodeAt(2*t+1) << 16)` and compute:

```text
big0(a) = rotr(a, 2) XOR rotr(a, 13) XOR rotr(a, 22)
big1(e) = rotr(e, 6) XOR rotr(e, 11) XOR rotr(e, 25)
choose  = (e AND f) XOR ((NOT e) AND g)
major   = (a AND b) XOR (a AND c) XOR (b AND c)
t1      = h + big1(e) + choose + k + W[t]
t2      = big0(a) + major
(a, b, c, d, e, f, g, h) <- (t1+t2, a, b, c, d+t1, e, f, g)
```

Assign in reverse dependency order, from `h = g` to `a = t1 + t2`. Add each final working word to its corresponding IV word and serialize with `writeBE32`. [FIPS 180-4 §§4–6](https://csrc.nist.gov/files/pubs/fips/180-4/final/docs/fips180-4.pdf).

### ChaCha20

Initialize scalar locals `x0…x15` with the four RFC constants, eight little-endian key words, the counter bit pattern, and three little-endian nonce words. Save those originals in a `new Int32Array(16)` (64 bytes) for feed-forward. In each of ten loop iterations, expand the eight quarter-round sites on named locals using this sequence:

```text
a = a + b    d = rotl(d XOR a, 16)
c = c + d    b = rotl(b XOR c, 12)
a = a + b    d = rotl(d XOR a,  8)
c = c + d    b = rotl(b XOR c,  7)
```

Use columns `(0,4,8,12)`, `(1,5,9,13)`, `(2,6,10,14)`, `(3,7,11,15)`, then diagonals `(0,5,10,15)`, `(1,6,11,12)`, `(2,7,8,13)`, `(3,4,9,14)`. Write each `xi + initial[i]` with `writeLE32` at offset `4*i`. [RFC 8439 §2.3](https://www.rfc-editor.org/rfc/rfc8439.html#section-2.3).

## Compiler experiments

- **IRWB-003.** Examine whether `speed` exposes fixed shift counts through inlining, reduces loop overhead through rotation, and coalesces copies. Inspect ChaCha's liveness and spills at two register budgets. Toggle `homes` when inspecting SHA's repeated IV constants.
- **IRWB-006, IRWB-008 and IRWB-010.** Inspect the rotate and Boolean expressions with SSA and verified rule tables. Compare equivalent windows by RV32IMF instruction cost. RV32IMF lowers rotates to instruction sequences. Check rewrite instances exactly where supported and retain whole-kernel differential checks. Counts 0 and 32 are useful direct tests because both shifts mask to zero, so an OR-to-XOR rewrite needs a guard.
- **IRWB-007.** Compare the same SHA source with the round table dynamic and under a specialization precondition fixing its length and read-only contents. Unrolling can expose individual indices and constants. A fixed `cells` input spec supplies fixtures and by itself grants no specialization assumption. On one explicit fixture with a modified round table, require the general image to agree with r0 and confirm that the changed table changes the digest.
- **IRWB-011.** Use exact byte equality as the integer control for tolerance experiments.

## Corpus and checks

Create `corpus/projects/crypto-blocks/` with `main.typed`, `project.json`, `notes.md` and `scripts/measure.js`. Use title `SHA-256 and ChaCha20`, group `Programs`, pipeline `speed`, and a source focus on a SHA rotation call. Mark the measurement script fresh. Set `project.json.inputs` by function and argument as follows. Here `B(n,m)` means `{"buffer":[n,m],"cell":[0,255]}`, `O(n)` means `{"buffer":[n,n],"cell":[256,256]}` for an output sentinel, and `I` means `[-2147483648,2147483647]`. Expand these into literal JSON. [Corpus project API](../../../../../../corpus/reference.md).

| Function | Input specs |
| --- | --- |
| `sha256` | `message: B(0,55)`, `out: O(32)`, `roundK: {"cells":[…]}` with the 64 FIPS §4.2.2 words split into low and high 16-bit cells |
| `chacha20Block` | `key: B(32,32)`, `nonce: B(12,12)`, `counter: I`, `out: O(64)` |
| `rotr`, `rotl` | `x: I`, `n: [0,31]` |
| `readLE32` | `bytes: B(32,32)`, `at: [0,28]` |
| `writeBE32`, `writeLE32` | `out: O(64)`, `at: [0,60]`, `word: I` |

`meaningKept` budgets 20,000 executed IR statements per function case, including callees. A planning allowance of 18 statements per packed byte, 22 per schedule expansion and 45 per SHA round plus 300 for setup and writes totals about 5,300. ChaCha's 80 quarter rounds at 36 statements each plus 500 for setup, loops and writes total about 3,400. Measure actual steps at r0 and after each changed pass, including SHA's maximum length. Require every case to finish within the default cap. [Case generator and pass check](../../../../../../src/typed/evaluate.ts).

1. Add `tests/typed/crypto-blocks.test.mjs` using NIST's one-block `abc` digest and the RFC §2.3.2 and Appendix A.1 zero-input ChaCha blocks. Compare every byte, return status and guest memory. Build expected memory by copying the input image and replacing only the output cells. Run the fixtures on the r0 evaluator and both RV32 compiler paths. [NIST known answer](https://csrc.nist.gov/csrc/media/projects/cryptographic-standards-and-guidelines/documents/examples/sha256.pdf), [RFC block vectors](https://www.rfc-editor.org/rfc/rfc8439.html#section-2.3.2), [RFC zero-input block](https://www.rfc-editor.org/rfc/rfc8439.html#appendix-A.1).
2. Check SHA lengths 0 and 55 and a non-ASCII text case against the framework's `sha256(text)`. Pass the text's UTF-8 bytes to Typed. [Framework SHA-256](../../../../../../src/framework/core/data.ts).
3. Run generated cases through checked `O2` and `speed` pipelines from fresh r0 copies. Check the reference image against r0 and the workbench images against their evaluator revisions using the same case memory. Require zero disagreements, valid-input traps, faults and inconclusives. [Reference checker](../../../../../../tools/reference-check.mjs).

## Measurement and implementation order

Using identical fixtures and fresh output buffers, measure the workbench's r0, O2 and speed images. Use 55 ASCII `a` bytes for SHA and the RFC §2.3.2 ChaCha input. Divide emulator `steps` by 55 message bytes or 64 keystream bytes respectively. Include entry and output work, and record raw steps, image size and spills alongside the ratios. For the pressure experiment, rerun the speed ChaCha image with an eight-register allocation budget and compare it with the default. Use the same fixture for a specialized SHA image or any later separate hand-tuned ceiling. [Backend options](../../../../../../src/typed/backend/options.ts).

Implement the rotate and serialization helpers first, then SHA and ChaCha. Establish published answers before running the checked pipelines. Add the manifest and measurement script, confirm the step counts and 16-word liveness, then record the baseline before attempting rewrites or specialization.

## Cuts after self-review

- Removed multi-block SHA, chaining state and the two-block vector. One padded block runs the complete schedule and all 64 rounds.
- Made ChaCha's four setup constants literals and dropped alternate sigma cases. The SHA round table already provides a hot specialization target.
- Removed malformed-input handling, byte-cell masking and their tests. The harness controls buffer lengths and byte values.
- Replaced the alternate-table generator and specialization dispatcher with one altered-table fixture and an explicit precondition. That isolates the specialization experiment from harness and dispatch costs.
- Dropped extra host oracle implementations and the separate vector script. Published vectors and the framework SHA cover independent correctness in one host test.
- Reduced the case matrix and step worksheet to representative fixtures, generated checks and cap measurements. This covers the exercised paths with fewer prescribed runs.
- Trimmed the timing matrix to one fixture per kernel, three revisions and one reduced-register comparison. Raw steps and instructions per byte capture the baseline directly.
- Consolidated the ticket-by-ticket experiments and implementation checklist. The remaining steps identify where to observe each compiler effect.
