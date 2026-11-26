---
Title: Chess search corpus project
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
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/apps/typed/chess/search.typed
      Note: Explicit-stack alpha-beta and search budgets
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/bench/host/chess-engine.mjs
      Note: Host FEN encoding and upstream search assertions
    - Path: abs:///home/manuel/code/wesen/2026-10-20--ds-js-os/bench/reference/chess/reference-positions.json
      Note: Independent legal move and perft fixtures
    - Path: repo://corpus/reference.md
      Note: Project API and input formats
    - Path: repo://src/typed/evaluate.ts
      Note: Generated inputs and the per-pass statement cap
    - Path: repo://src/typed/lift.ts
      Note: Default front end and u16 buffer lowering
    - Path: repo://tools/reference-check.mjs
      Note: Reference compiler parity runner
ExternalSources: []
Summary: Port the existing Typed chess core as a checked corpus project with bounded pass cases and independent chess fixtures.
LastUpdated: 2026-11-26T10:34:45.107891853-05:00
WhatFor: ""
WhenToUse: ""
---

# Chess search corpus project

Add `corpus/projects/chess` by porting the existing Typed engine from `/home/manuel/code/wesen/2026-10-20--ds-js-os` at `b19062b29fe4fb6b02863e92510501dc5c4bc9b3`. A position is an 8×8 board in a u16 buffer. Move generation follows piece-specific branches and walks rays until blocked. Search makes and unmakes moves through an explicit stack, updates alpha and beta at returns, and can stop mid-iteration under a node budget. That mix makes chess a test of control flow, small calls, and mutable memory on RV32IMF.

Use the upstream algorithms and ordinary source expressions, including division and remainder in coordinate decoding, separate helpers, short-circuit guards, and insertion sorting for move ordering. Preserve generator order and the first equal-scoring move. Perft and search share one position and move engine. The port takes `position.typed`, `moves.typed`, and `search.typed` and extracts the search fields from `state.typed`. The UI, painter, event scheduler, and game adjudication stay in the upstream app. The host supplies legal fixture positions, so the guest needs no FEN parser or arbitrary-board validation. Record the upstream commit and file origins in the corpus notes.

## Position, moves, and search

All offsets below are **u16 cells after the buffer's four-byte length header**. Use `charCodeAt`, `setCharCodeAt`, and `.length`. Use a plain reference `record ChessSearchState` with the upstream search fields `running` and `advanced` (bool), and `ply`, `depth`, `maxDepth`, `budget`, `nodes`, `completed`, `bestMove`, and `score` (i32). The host allocates it independently of the board, one 32-bit word per declared field. Initialize every field in generated records and use field names or front-end layout metadata when reading memory. Signed scores in the record are ordinary i32s.

| Region | Upstream layout to retain |
| --- | --- |
| Board, cells 0–127 | Each rank has stride 16, with eight playable cells and eight padding cells. a8 is 0 and a1 is 112. Occupied piece code is kind 1–6 (pawn through king, in PNBRQK order) plus 8 for black. Zero is empty. |
| Position metadata, 128–134 | Side (0 white, 1 black), castling mask (KQkq = 1,2,4,8), en-passant square (128 means absent), white and black king squares, halfmove clock, fullmove number. |
| Search frames | `160 + 16*ply`. Slots 0–11 are ready, remaining depth, alpha, beta, best, count, cursor, pending move, best move, in-check, mode, and whether a legal move or stand-pat has been seen. Frame scores are biased by 32768. |
| Search undo | `384 + 10*ply`. Six cells preserve metadata 129–134, then moving piece, captured piece, and capture square. The tenth cell is spare. Side is restored by toggling. |
| Search moves and priorities | `1024 + 1024*ply`. First 512 cells hold move codes, the following 512 hold sort keys. Move code is `promotion*4096 + fromDense*64 + toDense`. Dense squares are in a8-to-h1 order and promotions 1–4 mean Q/R/B/N. Zero is the no-move sentinel. |
| Perft scratch | Frames at `160 + 4*ply` hold ready, count, cursor, and pending move. Undo starts at `256 + 10*ply`, and legal move lists at `512 + 512*ply`. Use one operation at a time per board arena. |

The full arena is 12,288 cells (24,580 bytes including the length word). Search limits ordinary depth to six and caps quiescence at `depth + 4`. A capped checked node evaluates its evasions in place, so the deepest possible prepared frame is ply 10 and its priority list ends at cell 12,287. Perft uses depths 0–6 in the upstream routine, occupying at most 3,584 cells, and returns an i32 leaf count. Publish and qualify depths 0–3 for the supplied positions, where counts fit.

- **Position.** Keep square conversion, attacks, and `chessMake`/`chessUnmake`. Attacks test pawns and knights, then scan the eight king and slider directions. Make handles rook relocation, en-passant captures, promotions, rights, clocks, and side changes. Unmake restores every position cell after a temporary move. `chessCopyPosition` copies only cells 0–134.
- **Moves and perft.** `chessPseudoMoves` scans the 64 playable squares and dispatches by piece. Keep the 512-slot overflow check. `chessLegal` makes a candidate, tests the moving king, and unmakes it. Castling checks the starting and transit squares in generation and the destination in legality filtering. Perft counts legal move sequences to exactly the requested depth, with one leaf at depth zero and zero at positive depths from a terminal position. At the last ply it adds the legal list's length. At earlier plies it pushes a move, descends, and restores before advancing the cursor.
- **Search.** `chessStartSearch` finds a fallback legal move and initializes a full alpha-beta window at depth one. `chessPrepareNode` checks the budget before counting a node, then generates and optionally orders candidates. `chessSearchStep` attempts or rejects a move, descends with window `[-beta, -alpha]`, or completes the frame. `chessCompleteNode` negates the child score, unmakes the pending move, and updates the parent's best and alpha. A beta cutoff advances the cursor to the end. At the root, publish the completed score and move, then deepen or stop. Keep the upstream material and advanced evaluators, quiescence on captures/promotions, checked evasions, mate-distance scoring, and `chessStopSearch` unwind on budget exhaustion. A suspended slice can have moves on the board and must resume with the same arena and record.

Add one entry in `main.typed`, `chessRunSearch(board: buffer, state: ChessSearchState, options: buffer): i32`. Require a full arena and exactly four option cells, in order **depth, node budget, advanced flag (0/1), slice length (1–64)**. Return -1 before writes for malformed lengths, mode, or slice size. Pass depth and budget through the upstream clamps. Call `chessStartSearch`, then call `chessSearchSlice` until `state.running` is false. Return `state.bestMove` and leave the score, completed depth, and nodes in the record. Terminal roots return zero and record score 0 for stalemate or -30000 for mate. Completed and budget-stopped runs restore the 135 position cells. Scratch and the state record remain observable to the workbench's byte comparison. The host can still call the upstream start/slice pair directly to exercise suspension.

The port can use the default front end. A read-only probe concatenated the four unchanged upstream files in host order and ingested all 53 functions with `Program`, then lowered them and compiled a reference image. The used features are scalar i32/bool operations (including integer `Math.min/max`), calls, buffer reads and writes, reference record fields, and structured loops and branches. The lifter maps the front end's checked access control flow and u16 operations to loads/stores and CFG branches, preserves call order, and represents record fields by word offsets. Preserve the acyclic function graph. Candela shows that frame-local `Int32Array` is available, but this port retains the upstream u16 allocator-free layout, including across calls. [Lifter](../../../../../../src/typed/lift.ts), [integer Math example](../../../../../../corpus/projects/match-enum/main.typed), [Candela explicit stack](../../../../../../corpus/candela-gallery/kernel.typed#L521)

## Oracles and regression cases

Copy the fixture JSON from upstream `bench/reference/chess/reference-positions.json`, labeled `chess 1.11.2`, and preserve its attribution. Read the FEN in the host. Expand ranks from a8 downwards, assign piece codes and king caches, fill all seven metadata cells, and zero padding and unused scratch. Decode each returned move back to UCI including any promotion suffix. Compare the **sorted list** with the reference legal UCI list, compare the check flag separately, and derive mate or stalemate from count zero and that flag. Check every perft depth supplied by the fixture. Also bring over the upstream `bench/host/chess-engine.mjs` Kiwipete fixture. Its FEN is `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1`.

| Position | Perft 1 | Perft 2 | Perft 3 |
| --- | ---: | ---: | ---: |
| Opening | 20 | 400 | 8,902 |
| Kiwipete | 48 | 2,039 | |
| Castling both sides / through attack | 26 / 23 | 568 / 271 | |
| En passant pinned / legal | 6 / 7 | 77 / 27 | |
| Promotion and underpromotion | 9 | 41 | |
| Mate in one, white / black | 20 / 20 | 153 / 153 | |
| Quiet mate in two | 31 | 67 | |
| Stalemate / checkmate | 0 / 0 | 0 / 0 | |
| Defended rook | 24 | 380 | |

Keep an exact copy of the 135 input cells and compare it after legal generation, perft, and search completion or cancellation. Test make/unmake as its own round trip for ordinary captures, rook movement during castling, en passant and all promotions. On a perft failure, run a root divide in the host by making each legal move, running perft at depth minus one, and unmaking it with a reserved undo slot beyond the perft scratch. Report UCI and subtree counts.

Port the **assertions** from `bench/host/chess-engine.mjs` into a local Node test using the workbench APIs. Check that the returned move is in the independent legal set. With the same upstream search settings, check mate-in-one membership and +29999, quiet mate in two `d6c7` and +29997 in deepening, and defended rook `d1d5` in material mode but a different legal move in quiescence. Check terminal scores and budget-one fallback (first move in the engine's own legal order, depth completed zero), `nodes <= budget`, and that finishing the same run at slice sizes 1 and 19 yields the same result and search fields. For an exact port check on non-forced positions, record upstream reference tuples (packed move, score, completed depth, nodes) using the pinned source and compare to the port with the same inputs. Those tuples check preservation of the upstream algorithm, while perft, UCI lists, and mate witnesses independently check chess behavior.

Reference compiler parity is an additional compiler check. Use the procedure in `tools/reference-check.mjs` to compile the joined Typed with the vendored reference compiler, wrap its image with `imageFromCode`, and execute the same initialized args and bytes with `runImage`. Compare evaluator r0, checked head, and both RV32 images using `agrees` and verify the fixture assertions on the results. Use `benchCase` for concrete case memory and decode returned bytes with a DataView for the entire 135-cell position, the move list, and the record. `Program.exec` presents only a short buffer preview. [Reference check](../../../../../../tools/reference-check.mjs), [evaluator and comparison](../../../../../../src/typed/evaluate.ts), [emulator runner](../../../../../../src/typed/backend/run.ts)

## Generated inputs and the pass budget

In this checkout both `Program.fromProject` and the direct `runPipeline` path used by `tools/parity.mjs` check every function of a normal corpus project. `Program` has an explicit `entries` constructor option, but project metadata does not wire it through. Supply inputs for every ported signature so the project works with today's loaders and parity tools. In particular, random u16s are invalid for a board, and independently sampled `ply`, `frame`, and move-list contents need not describe a reachable state. `oneOf` in `makeValue` selects a number, so it cannot choose among prebuilt buffers or tuples. Generate one coherent fixture per function in `project.json` and use explicit host cases for the wider position matrix. [Project assembly and direct runner](../../../../../../src/typed/project.ts), [Program loader](../../../../../../src/typed/program.ts), [case generation](../../../../../../src/typed/evaluate.ts)

Derive checked-in JSON from the FEN encoder and a small per-function fixture table. Use `{ "cells": [...] }` for serialized board and option buffers, `{ "record": {...} }` for state, scalar numbers for coupled parameters, and inclusive ranges or numeric `oneOf` for independent ones. For example, `chessRunSearch.options` is `{ "cells": [1, 4, 0, 16] }` and its board is the zero-padded 12,288-cell encoding of `k7/2K5/8/8/8/8/8/8 b - - 0 1`. Black has one legal move, a8a7 (packed 8). The position exercises pushing, evaluating and unwinding a child. For pure helpers, examples are `chessRay.direction: [0, 7]`, `chessFrom.move: [1, 20479]`, and `chessOnBoard.square: [-32, 160]`. Use `{ "buffer": [135, 135], "cell": [0, 0] }` for a blank copy destination or reset target.

| Checked functions | Generated fixture recipe |
| --- | --- |
| Pure square, move, direction and score arithmetic | Use numeric ranges in the documented domains. Include boundary and padding squares for `chessOnBoard`, valid 0x88 squares for `chessDense` and `chessMove`, promotion 0–4 for packing, and individual masks 1/2/4/8 for rights helpers. |
| Board access, attacks, start, copy and evaluation | Use real board cells and matching side/square. Use pinned en passant for an attack-sensitive board, and allow `advanced` 0/1 for the stand-alone evaluator. `chessStartSearch` uses the forced board with depth 1, budget 4, and either mode. |
| Move generation, insertion, ordering, and legality | Use the promotion board for full pseudo/legal lists. Give low-level emitters their correct starting square/piece/side and an empty list starting at 1024. Use a castle fixture with the correct king/rights for direct `chessCastle`. For make and legality, supply a real packed move, such as e5d6 (1811) from the legal en-passant fixture, with undo starting at 384. For unmake, serialize the resulting board and undo together from a validated make. For order, first legal and tactical filtering, serialize an actual pseudo list and fix the matching count and previous move. |
| `chessPerft` | Use the forced board with depth `[0, 2]` and 1,536 cells. Exercise promotion and en-passant perft at depth 1 in focused host checks within the same cap. |
| Search frame helpers and slice entry points | Snapshot the forced board and every state field at known boundaries in the upstream start/step sequence. Use the started root for `chessPrepareNode`, a prepared root for `chessSearchStep`, and a live child with pending move and undo for `chessStopSearch` and `chessCompleteNode`. Use the started root with steps `[1, 8]` for `chessSearchSlice`. For direct frame writes such as `chessInitNode` and `chessAcceptScore`, use the real frame offset and a small signed score range around a known alpha/beta boundary, holding the other preconditions fixed. |
| `chessRunSearch` | Use the forced board, zeroed state, and options above. Run explicit companion cases for terminal return, malformed options, and a budget-one unwind. |

Use the actual parameter names from the declarations and fail generation if any board, record, list index, or correlated scalar falls back to a default. Reuse host encodings and snapshots when emitting the JSON. Trim scratch for stand-alone helper cases to the highest permitted access for that fixture, respecting the full-arena check at `chessRunSearch`. Replay snapshots in the host and verify preconditions before using them as concrete generated inputs. A fixed board can produce repeated cases across seeds, so report distinct fixtures and completed path coverage alongside the raw case totals.

The pass contract compares each changed revision with r0 via `casesFrom` and `meaningKept`, with a 20,000-statement cap in **each** execution. It compares the result and guest bytes, including scratch, and considers a limit hit inconclusive. Use zero inconclusives, zero unexpected traps, and zero disagreements as acceptance gates. Run a second focused checked pipeline on the same source with an inputs override for `chessRunSearch` using legal en passant and options `[2, 1, 1, 4]`. This covers advanced ordering and budget unwind in addition to the default completed material search. Probe the entire default fixture table at r0 and after each changed pass, including inlining and rotation, using the same check cap. Aim for at most 15,000 r0 statements per fixture to leave room for changed paths and adapter overhead.

The following read-only measurements are from the unchanged upstream source at r0. Each listed perft result matched on both RV32 images. The evaluator counts executed IR statements, including callees.

| Workload | Evaluator statements | Workbench RV32 instructions |
| --- | ---: | ---: |
| Forced position, perft 2 | 14,662 | 26,994 |
| Legal en passant, perft 1 | 9,418 | 17,247 |
| Promotion, perft 1 | 11,887 | 21,625 |
| Opening, perft 1 | 20,778 | 40,843 |
| Opening, perft 2 | 448,155 | 873,194 |
| Castling both sides, perft 2 | 827,902 | 1,516,174 |

On the forced position, start used 3,422 statements and an eight- or sixteen-step material slice from that snapshot used 9,381 and visited two nodes. The combined 12,803 statements leave room for the proposed adapter. Recheck its completed depth and actual statement count on the port. If another default case exceeds the target, choose a smaller position or reduce the slice width while retaining the intended branch in the default or focused test. Run all larger fixture tests with explicit limits outside the ordinary pass gate. There, use a 2 million statement / 5 million instruction ceiling initially for the depth-2 matrix. Give opening depth 3 and deep searches individually recorded ceilings based on a bounded calibration run and require decisive results. Keep the standard 20,000/200,000 caps on the ordinary generated evaluator/reference parity checks.

## Corpus files and performance experiments

Create `corpus/projects/chess/{main,state,position,moves,search}.typed`. Put the pinned reference fixtures in a local `fixtures/` directory, with a Node test in `tests/typed/chess.test.mjs` reading them by project path. In `notes.md`, describe the arena, engine provenance, sample forced and tactical runs, and how to investigate perft failures. Add `scripts/explore.js` to walk the blocks of `chessSearchStep` and point to the make/check/unmake and cutoff paths. A fresh `scripts/compare.js` should compare checked r0/O2/speed on the compact search fixture and report instruction counts with pass outcomes. Use the Node harness for the full benchmarks and byte-level checks. The project discovery helper finds the directory automatically. Add its ID to `corpus/projects/index.json` to place it with the other complete programs.

Set `project.json` to title “Chess search”, group `Programs`, pipeline `O2`, and sources in the order `state.typed`, `position.typed`, `moves.typed`, `search.typed`, `main.typed`. Include the generated per-function `inputs` map, script descriptions, and a `focus` line at the start of `chessSearchStep` in the joined source. Verify the focus after finalizing the files with the loader's source mapping. The `try` prompts can ask which helper calls survive `speed` and where instructions accumulate on a checked evasion. [Project API](../../../../../../corpus/reference.md), [sort metadata example](../../../../../../corpus/projects/sort/project.json), [corpus discovery](../../../../../../tools/corpus.mjs)

Use fresh programs and identical initial memory, search options, and backend options for r0, checked O2, and checked `speed`. Measure RV32 executed instructions for opening perft 2, castling and en passant perft 2, forced depth 1, and quiet-mate and defended-rook searches. The upstream profiles are material (mode 0, depth 1, budget 1800), quiescence (mode 1, depth 1, budget 1800), and deepening (mode 1, depth 3, budget 1600), all at slice 19, plus budget exhaustion (mode 1, depth 4, budget 1, slice 1). Run the same pinned inputs through the reference image and record its policy. Report counts per fixture, instruction ratio to r0, image bytes, nodes, and completed depth. Capture instruction heat and pass edits for a hot fixture and keep timeout rows out of ratios. Compare equivalent results before attributing any instruction change to the compiler.

| Optimization work | Experiment |
| --- | --- |
| IRWB-003, `speed` and the backend | Count survived calls to square conversion, attack/legality helpers, and move encoding. Inspect rotation on the ray and insertion loops, coalescing on search temporaries, and repeated constants such as 32768 and frame strides. Record spills and instruction heat as well as image size. |
| IRWB-006, rule tables and SSA | Follow the ready/cursor/alpha definitions through search joins. Look at small integer expressions and range-conditioned simplification of square packing and bounds guards. Inspect rule provenance where a rewrite fires. |
| IRWB-007, specialization | Begin with the separate read-only options buffer. Compare generic and specialized code on the same option values and a matrix of changing boards. A fixed depth, budget, or mode can affect loops and branches. A position can be known at call entry, but make/unmake mutates the board. Use a proved memory version or an explicitly tracked copy before folding later board loads. Record the host promise and alias assumptions. Treat buffer-content specialization as research beyond the current scalar parameter binder. |
| IRWB-008, exact checking | Compare checked rule-backed edits on integer arithmetic with the evidence for empirical CFG and memory changes. A missed pinned en-passant test, for example, changes legal moves and should be caught by an appropriate fixture. |
| IRWB-010, rewrite search | Start from hot coordinate and frame-offset expressions or short machine windows identified by heat. A replacement for division or remainder needs the signed range precondition. Require verified rules or exact window evidence before using a discovered replacement. |
| IRWB-011, float tolerance | Chess is an integer control workload. Its moves, scores, counts, and memory use exact comparisons in any experiment involving a tolerance-enabled compiler. |

An optional later `chess-hand` project can estimate a ceiling by hand-strength-reducing proven nonnegative coordinate arithmetic and removing redundant address recomputation. Keep move order, score rules and the same search budget so it runs the same tree. Qualify it with the same fixture matrix and report its numbers independently.

## Implementation order

1. Copy the pinned core and fixtures into the future project and slim the search record. Verify default ingest, source mapping, and RV32 lowering. Keep the upstream file split and comments around frame layout.
2. Build the host FEN encoder, UCI decoder, and byte reader. Qualify position restoration, legal moves, check flags, and perft against the fixture file on the evaluator and both images. Run the supplied perft depths and use divide output for mismatches.
3. Add the search wrapper and qualify upstream search assertions, tuple parity, suspension and cancellation. Check exact board restoration at completion. Exercise invalid option inputs at the wrapper boundary.
4. Emit `project.json` inputs and replay every configured function at r0 with the standard cap. Run `npm test`, `node tools/parity.mjs chess`, and the reference parity checks with the generated inputs. Assert decisive agreement and inspect per-pass results for O2 and speed.
5. Add the corpus notes and exploration scripts. Capture the instruction baseline and fixture/configuration table before attempting a specialization or hand-optimized ceiling.
