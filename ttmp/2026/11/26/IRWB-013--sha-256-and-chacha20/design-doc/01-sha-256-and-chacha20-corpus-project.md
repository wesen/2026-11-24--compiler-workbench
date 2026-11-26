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
    - Path: repo://corpus/reference.md
      Note: Project and generated input contracts
    - Path: repo://src/framework/core/data.ts
      Note: Independent SHA-256 oracle for ASCII inputs
    - Path: repo://src/typed/evaluate.ts
      Note: Generated cases, memory comparison, and the statement budget
    - Path: repo://src/typed/lift.ts
      Note: Tape and Wasm ingest modes and frame array lowering
    - Path: repo://src/typed/program.ts
      Note: Program.fromProject propagation and pipeline checks
    - Path: repo://src/typed/project.ts
      Note: Project metadata and ingestProject propagation point
    - Path: repo://tools/reference-check.mjs
      Note: Reference image comparison and signature propagation point
ExternalSources: []
Summary: Two single-block integer kernels for checked RV32 optimization experiments.
LastUpdated: 2026-11-26T10:57:59.99718717-05:00
WhatFor: ""
WhenToUse: ""
---

# SHA-256 and ChaCha20 corpus project

Create one project, `corpus/projects/sha-chacha/`, with two independently callable kernels. SHA-256 hashes a short ASCII message using one padded block and the full 64-round schedule. ChaCha20 produces one 64-byte keystream block using all 20 rounds. Both run on RV32IMF with integer instructions. RV32IMF lacks rotate instructions, so the shift/OR forms expose bit-vector rewrite opportunities whose value must be judged with the available instructions. SHA-256 supplies indexed round constants and loop-carried copies. ChaCha20 keeps 16 working words live across each double round, giving the allocator a workload where spills, call boundaries, and coalescing can affect runtime.

- **IRWB-003** exercises `speed` on scalar helpers, loop rotation on both round loops, and copy coalescing and constant homes in the backend.
- **IRWB-006** supplies the rule and SSA forms in which to inspect the word operations and state updates.

## Word representation and entry points

Use `i32` for words, with addition modulo 2³² and logical right shift via `>>>`. Write right rotation as `(x >>> n) | (x << (32 - n))` and left rotation as `(x << n) | (x >>> (32 - n))`. Keep each in a small scalar helper, `rotr` or `rotl`. These are more readable than expanding every expression at its use, and inlining gives constant propagation the literal shift amounts. Use `x ^ -1` for bitwise complement.

External word buffers use two u16 cells per word, low half first. Read word `j` as `buf.charCodeAt(2*j) | (buf.charCodeAt(2*j+1) << 16)`. Write its two halves with `setCharCodeAt` using `word & 65535` and `word >>> 16`. The other option is four byte-valued cells per word. Two cells use the native width of the corpus buffer and halve the number of checked accesses. This cell order is independent of the byte order used to serialize a digest or keystream. Use ordinary assignments for loads and stores at the boundaries. Give both kernels an `i32` result equal to their first output word, and check every word through the output buffer.

| Function | Arguments and valid domain |
| --- | --- |
| `sha256Block(message, roundK, out)` | `message` is a buffer of 0–55 ASCII cells. `roundK` is the 128-cell table of 64 SHA-256 constants. `out` is a separate 16-cell buffer for eight digest words. |
| `chacha20Block(key, counter, nonce, out)` | `key` and `nonce` are 16- and 6-cell buffers for eight and three words. `counter` is one `i32` word. `out` is a separate 32-cell buffer for 16 words. |

Keep key and nonce as separate parameters so RFC vectors can be passed directly after packing. A combined buffer would save a pointer at the cost of an extra offset convention. Input buffers are read-only by construction. Generated calls allocate independent buffers, and manual calls follow the same layout.

## SHA-256

Use FIPS 180-4 for the constants and equations (sections 4.2.2, 5.1.1, 5.3.3, and 6.2.2). Keep the eight initial hash values as literals. Put the round constants in the input buffer so a future specialization can bind the table while leaving the message dynamic. Embedding 64 assignments in Typed would still leave indexed loads and would tie the table to the program instead of the input. One padded block is enough to execute the entire schedule and compare against a whole-message hash. Prepadding at the call site would require generating messages and matching padding together, while multiple blocks repeat the same optimization targets.

Allocate a zeroed `new Int32Array(64)` for the full schedule (256 bytes). For each ASCII cell `i` in the message, OR it into `w[i / 4]` shifted left by `(3 - (i & 3)) * 8`. Insert byte `0x80` the same way at `i = message.length`. Set `w[15] = message.length * 8`. The bound of 55 leaves both length words available and the high length word stays zero. Extend the schedule with a loop from 16 through 63. A 16-word ring would save frame space but would introduce indexing arithmetic that obscures the four schedule dependencies.

```text
s0(x) = rotr(x,7) ^ rotr(x,18) ^ (x >>> 3)
s1(x) = rotr(x,17) ^ rotr(x,19) ^ (x >>> 10)
w[t]  = w[t-16] + s0(w[t-15]) + w[t-7] + s1(w[t-2])

S0(a) = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22)
S1(e) = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25)
Ch    = (e & f) ^ ((e ^ -1) & g)
Maj   = (a & b) ^ (a & c) ^ (b & c)
T1    = h + S1(e) + Ch + roundK[t] + w[t]
T2    = S0(a) + Maj
(a,b,c,d,e,f,g,h) ← (T1+T2,a,b,c,d+T1,e,f,g)
```

Here `roundK[t]` means the paired-cell read. In Typed, bind rotate results to local temporaries when composing the expressions so the inliner can see calls at statement roots. Keep the eight working words in scalar locals initialized to the hash literals. For each of the 64 iterations, assign in order from `h` back to `a` after computing both temporaries. Add the corresponding initial hash word to each final working word and write all eight to `out`. A single round loop keeps the indexed constant load and state permutation visible to the compiler. Hand-unrolling the baseline would remove the loop optimization opportunity.

## ChaCha20

Initialize words 0–3 to `61707865 3320646e 79622d32 6b206574` in hex, words 4–11 from the key, word 12 from the scalar counter, and words 13–15 from the nonce. Name the 16 working locals `x0` through `x15` and retain the initial words for the final additions. An indexed working array would simplify the quarter-round calls but place the state in frame memory and lose the intended register-liveness test. Keeping the original values also avoids decoding the inputs a second time at feed-forward.

Use a four-`i32` value record `Quarter` for a helper `quarter(a, b, c, d)`. The helper updates local copies and returns `Quarter(a,b,c,d)`. This expresses four results without pointers or shared writes. An in-place helper over an array would make the source shorter at each call but lose the scalar state. Use literal rotate amounts in `rotl` calls.

```text
a += b   d = rotl(d ^ a,16)
c += d   b = rotl(b ^ c,12)
a += b   d = rotl(d ^ a,8)
c += d   b = rotl(b ^ c,7)
```

Write one loop of ten double rounds. Each iteration calls `quarter` on columns `(0,4,8,12) (1,5,9,13) (2,6,10,14) (3,7,11,15)`, then diagonals `(0,5,10,15) (1,6,11,12) (2,7,8,13) (3,4,9,14)`. Immediately copy the four returned fields to their matching locals before the next call. Eight explicit calls follow the fixed schedule without needing a permutation table or indexed state. After the loop, add each initial word back to the matching working word and write the 16 sums to `out`.

## Project metadata and generated inputs

Use `main.typed`, `project.json`, `notes.md`, and `scripts/explore.js`. Set the title to “SHA-256 and ChaCha20”, group to “Programs”, sources to `["main.typed"]`, ingest to `{"tape":true}`, pipeline to `"speed"`, and focus to the final 1-based source line of the SHA-256 round-loop header once the source exists. Set the script to run fresh. Use the notes for the input packing, instruction-count denominator, and the two hot loops. Corpus discovery already includes unlisted directories through `tools/corpus.mjs`.

In the table, “buffer” gives the exact `buffer` and `cell` ranges for an input specification. Use the literal array under `cells` for the constant table. Build that fixture from the published 64 words, writing each low half before its high half. Fixed lengths and independent cell ranges suffice for this domain. The generator does not need dependent fields.

| Function | `inputs` entries by parameter |
| --- | --- |
| `sha256Block` | `message` buffer `[0,55]`, cells `[0,127]`. `roundK` fixed `cells` as above. `out` buffer `[16,16]`, cells `[0,0]`. |
| `chacha20Block` | `key` buffer `[16,16]` and `nonce` buffer `[6,6]`, both cells `[0,65535]`. `counter` range `[-2147483648,2147483647]`. `out` buffer `[32,32]`, cells `[0,0]`. |
| `rotr`, `rotl` | `x` has the full signed i32 range. `n` uses `oneOf` with `[2,6,7,11,13,17,18,19,22,25]` for `rotr` and `[7,8,12,16]` for `rotl`. |
| `quarter` | `a`, `b`, `c`, and `d` each have the full signed i32 range. |

Apply these specs for every named function because the standard project contract also calls helpers independently. Keep SHA sigma expressions in the two loops so they do not need independent helper entries.

### Loader and reference runner

The browser already reads `ingest` in `src/workbench/projects.ts`. Add optional `ingest?: IngestOptions` to `ProjectMeta` and forward it from both `Program.fromProject` and `ingestProject`, preserving their defaults. This lets the existing browser and Node project paths read the same file. In `tools/reference-check.mjs`, pass the reference compiler's `r.signatures` as the fourth argument to `imageFromCode` so direct calls to `quarter` read all four return words. Pass signatures in the corpus-wide reference tests in `tests/typed/backend.test.mjs` as well.

A small Node probe using `tools/node-vendor.mjs` confirmed that the default project loader failed on `new Int32Array(64)` with `unknown tape opcode 252 at 9`. Opening the same source through the workbench with tape metadata succeeded. Direct tape ingest, the evaluator, the reference image, and the checked `speed` image agreed on wrapping addition, bitwise operations, a four-word value result, and all five written u16 cells. The standalone reference helper returned all four words with signatures supplied and a single scalar with the current runner arguments. A separate 55-cell probe confirmed zero initialization, dynamic indexing, positive integer division, and variable shifts for word packing in the evaluator and reference image.

## Oracle, step budget, and measurement

Check the complete SHA-256 digests for the empty message and `abc`, using the published expected hex already in `tests/framework/identity-caches.test.mjs`. Also check every generated SHA case against `sha256` from `src/framework/core/data.ts` by converting ASCII cells to a JS string. Its UTF-8 encoding preserves each ASCII byte, including zero. Decode output cells to words and format each word as eight hex digits in order. Using arbitrary byte cells would require a byte-oriented oracle because values above 127 would expand in UTF-8. Compare a length-55 case explicitly to exercise the last byte position before the length field.

For ChaCha20, use RFC 8439 section 2.3.2 (key bytes `00` through `1f`, counter 1, nonce bytes `000000090000004a00000000`) and the all-zero key, counter, and nonce in Appendix A.1, test vector 1. Pack bytes little-endian into the word buffers. Serialize each returned word little-endian and compare all 64 bytes to the published keystream blocks (the section 2.3.2 block starts `10f1e7e4`). Fixed published vectors independently catch algorithm and serialization mistakes. For generated ChaCha cases, compare to the reference compiler image and check pass revisions against r0. That compiler oracle checks lowering and execution of the same Typed source.

The pass budget is 20,000 executed IR statements per case (`src/typed/evaluate.ts`), including callees. For the SHA estimate of about 8,000 statements, budget 25 per message cell, 50 per schedule extension, 55 per round, and 500 for setup and output. Budget 50 per quarter-round call including moves and branches, plus 500 for ChaCha setup, loop control, and output, for about 4,500 statements. These are planning estimates. At implementation, run the longest SHA case and a ChaCha case with the 20,000 limit at r0 and through the changed pipeline revisions. Require zero rejected passes, inconclusive cases, traps, and mismatches for this project. Use the reference checker with signatures and its `--o2` mode, then run the checked `speed` image against r0 on those same generated cases and rerun the published vectors. Run the existing corpus tests and update the aggregate expectations in the backend and SSA suites from the expanded corpus. Format the project metadata and notes with `tools/format-corpus.mjs`.

Report the emulator's executed instructions divided by **64** for each entry and revision. SHA always processes one 64-byte padded compression block, even for the empty message. ChaCha always emits 64 bytes. Include the kernel's setup and stores in the count. In the fresh script, compare r0 and `speed` on a fixed 55-character ASCII message and the RFC section 2.3.2 ChaCha case, keeping backend options the same. Use the `coalesce`, `chains`, and `homes` options and inspect the hot loop listings for copies, shifts, and spills. A hand-tuned ceiling can live in a separate project if a baseline variant is needed.

## Implementation order

1. Wire tape ingest through the Node loader and pass signatures to the reference runner. Verify both with a small array and value-result fixture.
2. Add the Typed kernels and metadata. Check the published vectors at r0 first, including both output buffers and scalar first words.
3. Run the generated comparisons and verify statement budget headroom. Inspect the round loops and helper call sites after `speed`.
4. Add the fresh measurement script and record the byte denominator in the notes.

## Later

- **IRWB-007** can bind the SHA-256 round table when constant-memory specialization is available.
- **IRWB-008** can apply exact checking to verified, rule-citing edits in the integer round expressions.
- **IRWB-010** can use rotate, SHA-256 choice, and majority expressions as rewrite-search windows costed for RV32IMF.
- Add compiler-directed round unrolling when available so the baseline stays looped.
