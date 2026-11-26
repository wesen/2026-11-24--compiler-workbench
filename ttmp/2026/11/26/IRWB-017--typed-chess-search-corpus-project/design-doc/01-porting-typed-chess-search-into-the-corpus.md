---
Title: Porting Typed Chess Search into the Corpus
Ticket: IRWB-017
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
      Note: Local frame-array stack example
    - Path: repo://corpus/reference.md
      Note: Corpus conventions and generated inputs
    - Path: repo://src/typed/evaluate.ts
      Note: Case construction and per-pass comparison
    - Path: repo://src/typed/lift.ts
      Note: Tape ingestion and memory lowering
    - Path: repo://src/typed/program.ts
      Note: Entry-scoped program checks
    - Path: repo://src/workbench/projects.ts
      Note: Built-in project load and tape options
    - Path: repo://tools/reference-check.mjs
      Note: Independent compiler image check
ExternalSources: []
Summary: Bounded perft and alpha-beta over the existing Typed chess engine, with independent fixtures and RV32 measurements.
LastUpdated: 2026-11-26T11:54:29.335544881-05:00
WhatFor: ""
WhenToUse: ""
---

# Porting Typed Chess Search into the Corpus

## Goal and source

Add `corpus/projects/chess-search/` as a port of the existing Typed chess engine. Preserve its position updates, legal move generation, evaluation, and explicit-stack alpha-beta search. Chess gives the compiler small calls inside branchy code, ray scans that exit on occupancy, and a search loop that changes direction as it descends, returns, or cuts off. A move-generation-only project would be easier to fit in the pass budget, but would miss the search transitions and values live across calls.

The upstream inventory starts with `apps/typed/chess/{position,moves,search,state}.typed`, their engine dependencies, `bench/reference/chess/reference-positions.json`, and the runner under `bench/host/` in `2026-10-20--ds-js-os`. Those files were outside this design's inspection scope. Before porting, pin the upstream revision and record the exact symbols, helpers, layout, move ordering, evaluation data, and runner command. The boundaries and sizes below are proposed corpus interfaces. Audit the source before assigning upstream function names or claiming matching search scores.

## Supported calls

The input is a legal orthodox chess position with one king per side and consistent side-to-move, castling rights and en-passant target. Support ordinary movement, checks and pins, castling, en passant, and all four promotions. Both calls accept integer depths `0..3`. The query uses the supplied position alone. Repetition, the fifty-move rule, and adjudication by insufficient material are left out because the query carries no game history and the benchmark is about fixed-depth tree traversal. The search oracle must use the same adjudication choice as the port.

- `chessPerft(position: buffer, work: buffer, depth: i32): i32` counts legal paths of exactly `depth` plies. Depth zero returns one. An earlier terminal position has zero continuations. At positive depth leave the root legal move list available in the root lane of `work`, with its length in cell 67.
- `chessSearch(position: buffer, work: buffer, depth: i32, bestMove: buffer): i32` returns the exact signed integer score in the root side's perspective and writes the chosen move to `bestMove[0]`. Use the upstream evaluation and mate-score convention, adapting the sign at the entry if needed. Document the imported mate score and its ply adjustment when pinning upstream. Search exactly the requested depth with a full initial window. Detect checkmate and stalemate before using the static score at a horizon leaf. Write zero for a depth-zero or terminal root. At positive nonterminal roots retain the first best move in the port's upstream move order on ties. Preserve the source's deterministic order and document it at import.

Both calls receive fresh, disjoint buffers. The position remains unchanged. Each call initializes its board in `work` and leaves that board restored to the root position on return. Scratch cells beyond the defined observations are internal to the engine. Inputs include zero-filled scratch so every execution starts from identical bytes.

## Port and data layout

Keep the upstream engine's ordinary helper boundaries and branching. Adapt the memory interface at the corpus boundary, keeping upstream piece and move representations internally where possible. If the upstream board already fits the workspace with a different representation, translate once at entry and record the internal offsets and serialize the restored board into the documented output cells before returning. Retaining the whole app would bring in interactive state and host dependencies. Bring over the engine and the state fields used by its legality and search routines. Drop UI, input handling, rendering, clocks, and application session state. Exclude time controls, caches shared between calls, and extra search modes such as iterative deepening or horizon extensions if present. The fixed-depth query should use the upstream move generation, evaluation, and alpha-beta traversal.

| Storage | Size | Layout and ownership |
|---|---:|---|
| `position` | 67 u16 cells | Squares 0–63 in rank order from a1 through h8. Empty = 0, white pawn/knight/bishop/rook/queen/king = 1–6, black = 7–12 in the same order. Cell 64 is side (0 white, 1 black), 65 is castling mask (bits K, Q, k, q in order), 66 is zero or en-passant square plus one. |
| `work` board | Cells 0–67 | First 67 cells hold the mutable position, with the perft root list length in cell 67. |
| `work` moves | Cells 68–4163 | Four lanes of 512 moves, one lane for each ply including the horizon. Use two cells per move, low halfword then high halfword of the upstream encoding, and normalize the root perft lane on exit. A side has at most 16 pieces, each with at most 27 ordinary destinations or at most 12 promotion candidates for a pawn, plus at most two castling moves. This leaves room for a distinct list of pseudo-legal moves before filtering. |
| `work` undo | Cells 4164–4211 | Four 12-cell records, including one for a move tried during a horizon legality check. Each saves up to four distinct square indices and old pieces, old side, rights and en passant, and the changed-square count. A castle touches four squares and en passant touches three. Save original values before updating any of them. |
| Frame array | 32 i32 words in each driver | Four frames of eight words. Track next move, move count, phase, alpha, beta, best score, best move, and perft subtotal, reusing only fields relevant to that driver. Use literal `new Int32Array(32)` in the owning function. |
| `bestMove` | 1 u16 cell | Canonical move as `from + 64 * to + 4096 * promotion`, with promotion 0 or 1–4 for knight, bishop, rook, queen. Zero is reserved because a legal move changes squares. The perft root lane exposes the same canonical IDs in the low cell of each pair and clears their high cells. |

The host supplies `work` as exactly 4,212 cells. Use checked buffer accesses for board and move storage shared by helpers. An all-buffer stack would avoid the tape loader requirement, but would force signed alpha, beta and scores through u16 pack/unpack on every frame update. Frame arrays keep those values as i32 and are local to the driver. In the vendored frontend they cannot be passed or returned. One array per driver uses 128 bytes of frame data. The perft count fits i32 at depth three even with 512 moves at every node.

- `position.typed` owns copying the input, reading pieces and metadata, and make/unmake. Cover the rook movement in castles, the off-destination capture for en passant, promotion replacement, and rights changes after rook or king moves and rook captures. Restore every board cell and metadata field saved by make.
- `moves.typed` owns attack tests, piece dispatch, ray traversal, and generation. Filter candidates by king safety with the ported legality rule. Check the origin, transit, and destination for castling. A child lane may be filled while the parent lane remains live. At a depth-zero search node, a legal-move existence test may stop at the first legal move if the upstream terminal path allows it.
- `search.typed` owns perft and fixed-depth search drivers. For perft, enter a node, generate legal moves, then make one move and push or accumulate the leaf. On return, unmake before advancing the parent cursor. For search, carry the negated window `[-beta, -alpha]` to the child, negate its returned score, update the parent best and alpha, and finish the node at `alpha >= beta` or move exhaustion. Keep the root window wide enough for the upstream mate scores and their negation. Undo the child move before processing either a cutoff or another sibling. At the root, finalize output only after restoration. Use the upstream generation and ordering routines in both drivers. Perft visits every legal path, search may prune.
- `main.typed` exposes the two entry points and initializes the buffers and root parameters. Put reusable helpers in the files above. The loader joins declared sources into one Typed program, so cross-file calls use ordinary function names.

Use i32, booleans, loops, direct calls, buffer loads/stores, and fixed frame-array indexing. Keep the usual chess control flow and the original lookup and scoring work. Leave hoisting, copy removal and other source changes for compiler experiments. [Candela's mesh traversal](../../../../../../corpus/candela-gallery/kernel.typed#L521) shows the local-array stack pattern. [The lifter](../../../../../../src/typed/lift.ts#L596) handles frame addressing, zeroing, and checked buffer accesses.

## Generated cases and project wiring

Create `project.json` with title `Typed chess search`, group `Programs`, sources `["position.typed", "moves.typed", "search.typed", "main.typed"]`, pipeline `speed`, and a `focus` at the search driver's child-return and cutoff branch using the joined-source line number. Add `notes.md` to explain the stack and fixtures and `scripts/compare.js` to display outcomes and instruction counts before and after the checked pipeline. Use the style of the existing Blend and Sort scripts.

In the fixture adapter, expand FEN rank runs from rank 8 down to rank 1, reverse the ranks for the buffer, then encode the side, castling flags and en-passant target. Ignore the two clock fields. Set these input specs on the two entry functions. Here the position specs are described compactly. Expand each to a 67-element `{ "cells": [...] }` in the project manifest using the table above.

| Entry | `position` | `work` | `depth` | `bestMove` |
|---|---|---|---|---|
| `chessPerft` | White king a1 and black king h8, White to move, rights and en passant zero | `{"buffer":[4212,4212],"cell":[0,0]}` | `{"oneOf":[0,1,2]}` | |
| `chessSearch` | White king a1, white rook b1, black king h8, White to move, rights and en passant zero | `{"buffer":[4212,4212],"cell":[0,0]}` | `{"oneOf":[0,1]}` | `{"cells":[0]}` |

`casesFrom` instantiates parameters independently and treats `oneOf` as numeric choices. Use complete positions and independent depth choices. Random board cells would rarely yield valid chess positions, and `oneOf` cannot choose whole buffers. Put extra positions in the explicit oracle and measurement fixtures and run their entire manifest deterministically. A test of the generated suite should explicitly run all five entry/depth pairs as well as sampling the manifest.

**Small loader change for the port.** Pass `"entries": ["chessPerft", "chessSearch"]` through to the existing `Program` option in both `Program.fromProject` and the custom-ingest route in `src/workbench/projects.ts`. Preserve entry options in the fresh project path. Use the browser loader's existing `"ingest": {"tape":true}` field and forward it in the Node project's `Program.fromProject` path. Update direct corpus ingest callers used for this project to honor the same option. Without entry selection, the pass checker independently calls internal helpers with synthetic board and scratch state. Specifying inputs for every helper would duplicate those internal invariants in the manifest. Reuse the generator and pass contract as they stand. Add a check for open and fresh paths, and update the corpus-wide reference test's fixed historical totals to account for the new entries while still asserting their agreement and coverage. [Project assembly](../../../../../../src/typed/project.ts) · [Program options and checks](../../../../../../src/typed/program.ts) · [Browser loader](../../../../../../src/workbench/projects.ts) · [Reference aggregate](../../../../../../tests/typed/backend.test.mjs)

A minimal Node v24 probe joined two source files and checked fixed cells, zero buffers, numeric `oneOf`, a direct helper call, a loop, and a mutable output. Normal inspection ingest worked for buffer-only code. Adding a local array gave `unknown tape opcode 252 at 8` on that path. With tape ingest, the array case returned 17, wrote cells [17, 23], took 33 evaluator statements at r0, and produced 100/100 agreements against each RV32 image after the checked `speed` pipeline, with zero traps and inconclusive results. The probe used a source import hook and Node's TypeScript transform flag because the worktree had no build output. Normal implementation tests use the repository build. Keep the joined port within the default 64 Ki code-unit source limit after removing app code, and measure the joined size when importing.

## Oracles and sizing

1. **Chess rules.** Use frozen expected perft counts and the orthodox initial arrangement with White to move and all four castling rights. The initial position gives 1, 20, 400, 8,902 at depths 0–3. The generated corner-kings fixture gives 1, 3, 9 at depths 0–2 because the kings each have three moves and cannot meet within two plies. Run virtual root divisions for failures by applying a root move in the independent host harness and counting the child position at one less depth. Compare canonical root move sets where the host exposes them, with duplicate detection. Add upstream reference rows that cover check evasion, every promotion, legal and illegal en passant, castling, stalemate, and checkmate, supplementing absent cases with independently checked fixtures. Record the position and stated expected value before testing the port.
2. **Search behavior.** Run the pinned upstream host separately and convert its reference positions into corpus fixtures. Record upstream fixture IDs, exact depth and evaluation/search settings, and the integer score and legal best move. Compare exact moves on unique-best positions. For ties, check membership in the oracle's best-scoring set and separately assert the port's documented first-best tie behavior. If the upstream runner does not expose an equivalent fixed-depth mode, use a small host minimax over the upstream legal-move and evaluator APIs with the same terminal conventions, so alpha-beta traversal and the stack implementation are independently checked. Determine the relevant upstream APIs at source audit and record the command in the eventual `notes.md`. Cross-check perft with published counts even when the upstream implementation is used as a search oracle, since the port and upstream may share a move-generation bug.
3. **Compiler behavior.** First require r0 to agree with the chess fixtures. Then let the existing per-pass contract compare returns and guest memory with r0. On the same concrete cases use `typedRv32.compile`, `imageFromCode`, and `runImage` as shown in [the reference checker](../../../../../../tools/reference-check.mjs), and compare both Workbench RV32 images and the reference image with the evaluator. Require no fault, trap or timeout, match the returned score/count, defined root moves, and restored board against the chess fixtures, and compare guest bytes for identical-program compiler checks. Compare the full memory image via the low-level run results, because the display API clips buffers. Construct fresh memory for each invocation. Do not treat a matching compiler result as validation of the chess rules.

The checked workload is deliberately sparse. The largest generated perft tree has 13 positions including the root, with move generation at four internal positions. Its root moves are a1–a2, a1–b1, and a1–b2. The search suite expands one root and at most one additional horizon position per legal root move. Early legal-move detection at the horizon keeps terminal checks bounded by one candidate scan per leaf. Budget for board copying, square scans, attack checks, make/unmake, and frame transitions using actual evaluator statement counts. These may dominate the number of tree nodes.

Enumerate every generated entry/depth pair with `benchCase` and `evaluate` at r0 and every accepted revision. Require at most 15,000 statements each as a target with headroom below the actual 20,000-statement gate. Also require completion in 200,000 instructions on both RV32 images for those pairs. If a default exceeds the target, lower its depth or swap in a sparser verified fixture. Keep at least one positive-depth alpha-beta run and a perft run that descends and returns through two plies. Run start-position perft at depths 2–3 and deeper or crowded search fixtures as explicit tests with finite, separately recorded limits, outside the generated gate. Limit hits are inconclusive in the Workbench and fail qualification for the generated suite. No chess-sized timings are available yet. [Case construction and statement counter](../../../../../../src/typed/evaluate.ts)

## Optimization and measurement

| Work | What to inspect |
|---|---|
| IRWB-003, `speed` | Look for inlining of small piece/color and address helpers within move generation, rotation of candidate and ray loops, fewer moves at joins after coalescing, and repeated masks or lane offsets built once with constant homes. |
| IRWB-006, rule tables and SSA | Inspect folded or simplified packing expressions and the reaching definitions of alpha and the move cursor across descent and cutoff edges. Use the existing rule tables and SSA view on selected functions. |
| IRWB-007, specialization | Measure ordinary calls over multiple positions and repeat with a single frozen `position` buffer and fixed requested depth. The corpus ABI keeps position bytes outside the source. The current specialization pass binds scalars or record fields, so today it can test a scalar depth restriction. A fixed buffer case measures the same generic code until memory-backed specialization exists. |
| IRWB-008, exact checking | Use move packing/unpacking and square-index arithmetic as candidates for exact local equivalence checks. Keep sampled whole-entry checks for move generation and search, whose behavior involves memory and control flow. |
| IRWB-010, rewrite discovery | Supply small real integer expression windows from square indexing and move encoding. Use emulator heat to decide whether a discovered rewrite matters in the full program. |
| IRWB-011, float contracts | Use chess as an integer control. Every score, move and count is exact. |

On each fixed fixture compare r0, checked O2, and checked `speed` with the same backend options. Then measure `speed` with `chains`, `coalesce`, and `homes` individually and together, plus the reference compiler's default image. Record fixture, depth, pipeline revision, flags, result, evaluator steps, emulator instructions, image bytes and spills. Report per-fixture instruction counts and ratios to r0, and inspect source-level instruction heat around generation, leaf evaluation, and cutoff handling. Keep order and node workload the same for compiler comparisons. If a separate hand-tuned project is later used as a ceiling, run the same fixtures, search policy, and order and label it separately. A single source and repeated runs are sufficient for the first corpus project. [Speed pipeline](../../../../../../src/typed/passes.ts#L1104) · [Backend options](../../../../../../src/typed/backend/options.ts) · [Specialization scope](../../../../../../src/typed/specialize.ts)

## Implementation sequence

1. Pin upstream and map its core and host runner. Freeze the FEN-to-buffer adapter and oracle fixture expectations. Verify mixed positions with both sides to move and all special move types before using runtime results as goldens.
2. Wire project entry selection and tape ingestion. Ingest a small cross-file skeleton from the normal browser and Node project paths and run the RV32 checker on both roots.
3. Port position and move generation first. Exercise make/unmake through ordinary moves and each special move, then compare root moves and perft counts with the independent fixtures.
4. Port the fixed-depth explicit-stack search. Check horizon and terminal scores, ties, cutoff restoration, and repeatability on fresh input. Include a depth-two search fixture with a demonstrated cutoff in the explicit suite.
5. Qualify the generated pairs at every checked revision and on both RV32 engines. Add the single corpus project, fixture test, notes, and comparison script, then capture instruction counts.

## Later

- Board-buffer partial evaluation once the compiler can bind immutable buffer contents.
- Broader proof and rewrite-search experiments once their checking and search paths support the selected integer windows.
- A separate hand-tuned ceiling after the baseline port reports stable measurements.
