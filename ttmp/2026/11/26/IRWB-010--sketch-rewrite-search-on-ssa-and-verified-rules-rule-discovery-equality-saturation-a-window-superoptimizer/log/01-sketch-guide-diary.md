---
Title: Sketch guide diary
Ticket: IRWB-010
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Chronological investigation diary for the IRWB-010 sketch guide (rewrite search on SSA and verified rules): what was read, the grounding measurements on noise3 and fbm3, the writing and the upload."
LastUpdated: 2026-11-26T12:00:00-05:00
WhatFor: "Evidence trail behind every number in the IRWB-010 guide; resume point."
WhenToUse: "Read the latest step when resuming; expand earlier steps only as needed."
---

# Sketch guide diary

Steps are chronological, oldest first. Every number in a step comes from the command shown in it or from the file it cites. Scripts are in `../scripts/`, measurements in `../various/`. The worktree is `.claude/worktrees/agent-a6dc8f9fd165045d9`, branched from `a4beda6` on `irwb-001/import-v6-prototype`. IRWB-011's diary (`ttmp/2026/11/26/IRWB-011--*/log/01-sketch-guide-diary.md`) records the measurements the two tickets share.

## Step 1: Read the system the guide has to explain

The brief asks for an intern-grade sketch guide: the parts of the system a reader needs, background from scratch, the design space, first experiments with decision criteria, and open questions. Nothing is implemented. This step reads the code and the tickets the guide builds on, and records the facts the guide will cite, with the commit each was read at.

The main finding of the reading is that the three ingredients the direction names exist and are measured: SSA as a checked fact (`typed.ssa`), rules as data with recorded evidence (`src/typed/rules/`), and a verifier that rejects unsound rules. What does not exist yet is anything that searches: no enumerator, no e-graph, no machine-level IR a superoptimizer could rewrite.

### Prompt Context
**User prompt (verbatim):** "You can make "sketch tickets" for 4 and 5, i just don't want to lose the idea. For each, Create a detailed analysis / design / implementation guide that is for a new intern, explaining all the parts of the system needed to understand what it is, with prose paragraphs and bullet point sand pseudocode and diagrams and api references and file references. It should be very clear and technical. Store in the ticket and the nupload to remarkable."
**Assistant interpretation:** IRWB-010 is sketch ticket 4: rule discovery by enumeration with the verifier as the filter (IRWB-002 B3), equality saturation over value trees (B4), a window superoptimizer over RV32 (B5), aimed at `noise3` and `fbm3`; plus the coordinator's research framing (proof-producing e-graphs, extraction by RV32 cost, a missed-optimization loop from provenance, e-graphs inside "one revision per pass").
**Inferred user intent:** Keep the idea, in a form a new person can pick up and start on with the first experiment, without anyone having to reconstruct the reasoning.
**Commit (code):** none (reading only).

### What I did
- Loaded the skills `ticket-research-docmgr-remarkable`, `docmgr`, `diary`, `textbook-authoring`, `remarkable-upload`, and read the writing-style and investigation-entry references.
- Read IRWB-002's guide Part 1 (sections 1–17) and items B1–B6, D3, D4, D6 (`ttmp/2026/11/24/IRWB-002--*/design-doc/01-*.md`, lines 924–1067 and 1221–1361).
- Read IRWB-006 (merged): the diary steps 4–10 and the changelog; `src/typed/rules/form.ts`, `simplify.ts`, `compile.ts`, `verify.ts` (types and `verifyRule`), `semantics.ts` exports; `src/typed/ssa.ts` (types, `ssaOf`, `ssaView`, `checkSsa`); `src/typed/sccp.ts`.
- Read the backend's f32 lowering (`src/typed/backend/select.ts:1–32`, `:107–126`), `image.ts` (`ImageInsn` with `fn`, `op`, `covers`), `run.ts` (`runImage`, `heat`).
- Read `noise3`, `fbm3`, `gnoise` in `corpus/candela-gallery/kernel.typed:147–184` and located their callers.
- Read IRWB-003 (not merged) in `.claude/worktrees/agent-a5888d4d3c671b653` at its branch head `90fed9c` (read from `.git/refs/heads/worktree-agent-a5888d4d3c671b653`, since git commands on another worktree are refused): diary steps 8, 13, 14 and guide line 303.
- Read IRWB-005 (not merged) in `.claude/worktrees/agent-a6abc74d4c978a51f` at `d9cf4e9`: diary steps 4, 10, 14, 18.
- `npx tsc -p tsconfig.json` (6.9 s) to have `dist/` for the measurement scripts; `git status --short` stays empty (`dist/` is ignored).

### Why
- The guide must explain `typed.blocks`, value trees with one user, `Tx` provenance, the meaning contract, rules and evidence, SSA, the backend's tiles and `covers`, because each design choice of the sketch depends on one of them.

### What worked
- Facts the guide will cite (all at `a4beda6` unless stated):
  - `simplify` is 27 rules, `fold` 40 (`src/typed/rules/simplify.ts:14–80`, IRWB-006 diary step 4). On the corpus's O2, 9 of the 27 `simplify` rules fire and 18 never do; 5 of the 40 `fold` rules fire (IRWB-006 diary step 4, `various/03-rule-firings-corpus-o2.json`). On Candela's O2 four `simplify` rules fire: `add-zero` 1, `mul-pow2` 39, `not-le` 4, `not-lt` 12 (step 5).
  - Evidence: `simplify` 15 proof, 4 exhaustive, 8 reduced-width+argument; `fold` 40 by-construction; 7 of 7 unsound candidates rejected (IRWB-006 changelog, `src/typed/rules/evidence.ts`).
  - `verifyRule(r, opts): RuleEvidence` (`src/typed/rules/verify.ts:179`); `Strength` (`:63`); eight method names (`:39–47`).
  - `ssaOf(st, f): SsaFn` (`src/typed/ssa.ts:60`), `ssaView` (`:243`), `checkSsa` (`:325`); on Candela r0: 23,850 names, 4,245 phis of which 2,840 dead, 0 mismatches against reaching definitions (IRWB-006 step 7).
  - The framework's pattern search costs about 74 times the compiled matcher on the same 71 × 67 searches (47,425 ms against 641 ms, IRWB-006 step 9); rules are applied by the compiled `Tx.rewrite` visitor.
  - `simplify` leaves every f32 operator alone (`simplify.ts:79`, property of the set).
  - The f32 backend exists on this branch: `fadd.s`, `fsub.s`, `fmul.s`, `fdiv.s`, `fsqrt.s` with RNE, and no fused instruction is emitted (`select.ts:107–115`). The vendored interpreter executes `fmadd.s`, `fmsub.s`, `fnmsub.s`, `fnmadd.s` with one rounding (`vendor/ds-js-os/bench/host/rv32-interp.js:134–147`, `:379–383`).
  - `noise3` makes 14 calls (3 `q_floor`, 3 `q_fract`, 8 `gnoise`) against 8 in the reference compiler's `kernel` image; `fbm3` carries the largest per-function gap over the oracle cases, 1,816,438 instructions (IRWB-003 guide line 303, at `90fed9c`).
  - `fbm3` and `noise3` are called only from scene sections of scenes 5 and 12–17 (`s5_mat_0`, `s12_dens_0`, `s13_dens_0`, `s14_sdf_0..2`, `s14_mat_1`, `s15_sdf_0`, `s16_hf_0`, `s16_bumpH_1`, `s16_mat_0`, `s17_hf_0`; `grep -n 'fbm3(\|noise3(' corpus/candela-gallery/scenes.typed`). B-01 and R-01, the two scenes most measurements use, never reach them.
  - IRWB-003 at `90fed9c`: B-01 instructions per pixel 8,501 (`kernel`), 10,435 (O2+), 8,267.7 (`speed` with three backend options); R-01 15,655.9, 22,850.9, 18,186.7 (diary step 14).

### What didn't work
- `git -C <other worktree> log` and a `cat` of the other worktree's `.git` pointer in one compound command were both refused by the worktree isolation check ("this command names git in a form too complex to verify that it stays inside the worktree"). I read the branch heads with the Read tool instead: `.git/worktrees/agent-a5888d4d3c671b653/HEAD` → `refs/heads/worktree-agent-a5888d4d3c671b653` → `90fed9c0…`; IRWB-005 → `d9cf4e94…`.

### What I learned
- The hot functions the direction names are hot only in seven of the eighteen scenes. A measurement of their share of executed instructions has to render one of those scenes, not B-01.

### What was tricky to build
- Nothing built in this step.

### What warrants a second pair of eyes
- IRWB-003 and IRWB-005 may have uncommitted work beyond the branch heads; the guide cites only what those commits' files say.

### What should be done in the future
- Measure the value-tree shapes of `noise3` and `fbm3` at r0 and O2, and their share of executed instructions in a scene that calls them (next steps).

### Code review instructions
- Start with `src/typed/rules/form.ts`, `src/typed/rules/verify.ts:179`, `src/typed/ssa.ts:25–60`.

### Technical details
- The vault report is deferred to the implementation milestone (coordinator's correction, received during this step); none was written.

## Step 2: The O2 head, the shapes of noise3 and fbm3, and a measured phase-ordering example

This step produces the grounding numbers for the guide's section 8 and its background examples: Candela's O2 head (to compare trees at r0 and O2), a census of the value trees in `noise3`, `fbm3` and their callees with counts of candidate rewrite patterns, and the instruction counts of a few one-line functions that show the backend's costs and the phase-ordering problem.

The O2 head is the official chain (r0 `cd36346ea7c4`, head `b33d1737c725`, 13 revisions, as in IRWB-006). `noise3` is one block of 31 statements at O2 with 14 calls and 30 uses of only four f32 constants; O2 changes almost nothing in it. Across Candela, the most frequent candidate is a product feeding an addition or subtraction (820 sites at O2), which no exact rule can touch.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** The brief's cheap IRWB-010 measurement: tree shapes at r0 and O2 (operators, depth, constants), which candidate rewrites apply, and their share of executed instructions (next step).
**Inferred user intent:** Ground the sketch in what the target code really looks like.
**Commit (code):** de2fc14 holds the scripts; the outputs are committed with the next step.

### What I did
- `scripts/04-phase-order-example.mjs` (no Candela): `new Program(name, source)`, `p.pipeline('O2')`, `lowerToImage(p.head).image.value.insns` for one-line functions. First run failed (below); output `various/04-phase-order-example.txt`.
- `scripts/01-candela-o2-head.mjs`: ingest from the tape, `createIRArtifact`, then `applyPass(PASSES[name], cur, { manager })` for each pass of `PIPELINES.O2`, without the per-pass meaning checks (IRWB-006's method, diary step 5 there). Under the cap: `systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 /usr/bin/time -v node --max-old-space-size=10240 scripts/01-candela-o2-head.mjs --out-dir <scratchpad>/candela` → `various/01-candela-o2-head.{json,log}`; r0 and head JSON (18.2 MB and 16.3 MB) stay in the scratchpad.
- `scripts/02-value-tree-shapes.mjs --dir <scratchpad>/candela --json various/02-value-tree-shapes.json --listing various/02-noise-listings.txt` (under the cap) → `various/02-value-tree-shapes.txt`.

### Why
- Applying O2 without checks is valid for measuring shapes: the checks do not change a pass's output, and the head hash equals the checked chain's.

### What worked
- O2: `{"r0":"cd36346ea7c4","head":"b33d1737c725","revisions":13}`, 1 min 53 s wall, peak RSS 2,971,424 KB, exit 0.
- One-line functions, instructions without `ret`: f32 `x * 2.0` 3 (`lui`, `fmv.w.x`, `fmul.s`); `x + x` 1; `(x*x)*(3.0 - 2.0*x)` 8; `a + (b - a) * t` 3; i32 `(x * 2) * 3` becomes `(x << 1) * 3` under O2 (1 revision), 3 instructions; `x * 6` 2; `(x << 2) + (x << 1)` 3.
- Focus functions (r0 → O2): `noise3` 1 block, 33 → 31 statements, 177 → 175 values, 14 calls, f32 constants 4 distinct / 30 uses at both (0.0 × 12, 1.0 × 12, 2.0 × 3, 3.0 × 3), maximum depth 7, largest tree 13 → 21 nodes; patterns at both: 7 `fadd(fmul, ·)`, 3 `fsub(c, fmul)`, 3 `fmul(x, 2.0)`. `fbm3`: 10 → 8 blocks, 27 statements, 2 calls, 1 `fadd(fmul, ·)`. `gnoise`: 5 statements, 30 values, depth 5, 2 `fadd(fmul, ·)`, 1 nested `fadd`. `hash3`: 17 → 16 statements, 94 → 91 values, 9 `mul`, 9 `add`, 6 `shru`, 3 `xor`; 3 `fsub(fmul, c)`; its one `fdiv` at r0 is `2.0 / 16777216.0` (kernel.typed:2706), which `fold` evaluates to 1.1920929e-7 and `constprop` substitutes into the three products (O2: that constant with 3 uses).
- Candela at O2, pattern sites: contraction 820 (678 `fadd(fmul)`, 81 `fsub(c, fmul)`, 61 `fsub(fmul, c)`); any nested `fadd` 227; `fmul(x, 1.0)` 197 (25 at r0); `fmul(x, 2.0)` 38; `fdiv(x, c)` with c not a power of two 22, with c a power of two 15; `fadd(x, +0.0)` 7; `fmul(x, 0.0)` 5; `fsub(x, x)` 6; `fdiv(x, 1.0)` 5; constant reassociation `fmul(fmul(x, c1), c2)` 9, `fadd(fadd(x, c1), c2)` 1; i32 `mul(mul(x, c1), c2)` 1 at r0, 0 at O2.

### What didn't work
- `scripts/04-phase-order-example.mjs`, first run: `TypeError: Cannot read properties of undefined (reading 'filter')` at `image.insns`: `lowerToImage(...).image` is an artifact, and the image is its `.value`. Fixed there and in `03-heat.mjs` and IRWB-011's `03-float-candidates.mjs` with one `sed` each (`lowered.value ?? lowered`).
- `git add` of both ticket directories staged the O2 run's partial output while it was running; `git restore --staged` on the two files before the commit.

### What I learned
- `constprop` multiplies the payload-class pattern `fmul(x, 1.0)` by eight (25 → 197): it substitutes constants into products, and no rule removes a product by 1.0, because `x · 1.0 → x` is wrong for a non-canonical NaN `x`. A fact "x is an arithmetic result" (every NaN the evaluator computes is canonical, `f32.ts:11`) would make it valid on those sites.
- In `noise3`, 24 of the 30 constant uses are the `0.0`/`1.0` offset arguments of its eight `gnoise` calls. After inlining (IRWB-003) they become `i + 0.0` and `f − 0.0`. `i + 0.0 → i` is wrong for `i = −0`, and `hash3` reads the bits of `i + o` (`f2bits`), so the sign of zero is observable. It is valid only with a fact that `i` is not −0. `q_floor` never returns −0 by its code: `q_floor(−0)` returns `t = f32(i32(−0)) = +0` (kernel.typed:3–8), a claim from reading, not measured.
- O2 leaves `noise3` nearly unchanged: six copies (`t5 = t23` …) survive, and every constant is still rebuilt at each use.

### What was tricky to build
- Pattern matching on raw records rather than on `ValueHandle`s: the census needs no transaction, so it walks `st.get(id)` records directly; the reassociation patterns needed both operand orders (`nestedConst`).

### What warrants a second pair of eyes
- The census counts shapes, not rewrites the rules would make: overlapping patterns count once per matching node, and "any nested fadd" includes the constant case.

### What should be done in the future
- The heat measurement (next step): how much of a frame these shapes are.

### Code review instructions
- `scripts/02-value-tree-shapes.mjs` (`patternsOf`, `census`); `various/02-noise-listings.txt` for the four functions at r0 and O2.

### Technical details
- Pass times in the O2 run (ms): cfg 8,971; fold 7,353; simplify 10,034; constprop 11,345; fold 6,805; simplify (no change) 477; dce 5,923; cfg 5,170; licm 5,290; lvn 9,766; others in `various/01-candela-o2-head.json`.

## Step 3: Where a frame's instructions go in the scenes that call noise3

This step measures the share of executed instructions that `noise3`, `fbm3` and their callees take in two scenes that call them, at r0 and at the O2 head, and how those instructions split into arithmetic, constants, moves and calls. It is what decides whether rewrite search on these functions can pay.

The answer is that the functions are hot where they run (81.8 % of V-04's frame, 35.3 % of X-03's) but that their cost is mostly not algebra: in `noise3`, arithmetic is 14.5 % of its instructions, constant rebuilds 21.1 %, and register moves for its 14 calls 37.0 %. The only exact f32 rewrite visible, `x * 2.0 → x + x`, would save 0.40 % of V-04's frame.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** "their share of executed instructions if available from heat counts".
**Inferred user intent:** Know whether the target is worth a search before building one.
**Commit (code):** de2fc14 holds the script; outputs are committed after this step.

### What I did
- `scripts/03-heat.mjs`: for r0 and the O2 head, `createIRArtifact` + `lowerToImage` (default options), a `CandelaHost` whose engine calls `runImage(…, { counts })` and sums the per-word counts only while the frame is rendered (after `bind`); pass 0, stride 8 for 160 × 160 scenes and 4 for 80 × 80 ones (20 × 20 pixels). Attribution per `ImageInsn.fn`, per machine `op`, and per covered value (`covers[0]`): an instruction is "constant building" if it covers an f32 `const` value, and "fusable" if it is an `fadd.s`/`fsub.s` covering an `fadd`/`fsub` with an `fmul` operand.
- `systemd-run --user --scope --quiet -p MemoryMax=14G -p MemorySwapMax=0 /usr/bin/time -v node --max-old-space-size=10240 scripts/03-heat.mjs --dir <scratchpad>/candela --scenes X-03,V-04 --stride 8 --json various/03-heat.json` → `various/03-heat.{txt,log}`.
- Derived numbers with a `node -e` over `various/03-heat.json` (noise3 executions = its internal calls / 14; shares by op).

### Why
- X-03 and V-04 are two of the seven scenes that reach `fbm3` (Step 1); V-04 is a volume whose density is noise, X-03 a planet with noise terrain.

### What worked
- 1 min 53 s wall, peak RSS 1,298,176 KB, exit 0. In every row the counted instructions equal the host's step count (`counted === steps`).
- At the O2 head: V-04 108,341 instructions per pixel, noise family 81.8 % (`hash3` 33.9, `gnoise` 21.7, `noise3` 15.0, `q_floor` 7.1, `q_fract` 2.4, `fbm3` 1.7 %); X-03 365,180 per pixel, noise family 35.3 % (`hash3` 14.5, `logTail` 10.3, `gnoise` 9.3, `exp2f` 6.7, `noise3` 6.4 %, …). At r0: V-04 108,839, X-03 367,086.
- f32 constant building: 15.0 % (V-04) and 20.2 % (X-03) of the whole frame at O2. Fusable `fadd.s`/`fsub.s`: 3.93 % and 4.81 %; of these, 85.9 % (V-04) and 30.1 % (X-03) are inside the noise family.
- Inside `noise3` (same proportions in both scenes): `fsgnj.s` 37.0 %, constant building 21.1 %, `fmul.s` + `fadd.s` + `fsub.s` 14.5 %; 14 calls per execution; 28,685 executions in V-04, 41,466 in X-03. `gnoise`: `fsgnj.s` 26.8 %, `fsw` + `flw` 29.3 %. `hash3`: `lui` 18.8 %, f32 constant building 18.8 % (its integer constants' `lui`/`addi` are not separated by the script).
- r0 against O2: `noise3` and `gnoise` identical (9,412,782 and 13,600,848 in X-03); `hash3` 14,457,240 → 14,686,720 in V-04 and 20,898,864 → 21,230,592 in X-03, slower at O2; its f32 constant building rises 2,294,800 → 2,753,760 in V-04.
- `x * 2.0 → x + x` estimate: 3 sites × 2 instructions × 28,685 = 172,110 of 43,336,282 (0.40 %) in V-04; 248,796 of 146,072,040 (0.17 %) in X-03.

### What didn't work
- No failure in this step.

### What I learned
- The scenes most measurements use (B-01, R-01) say nothing about this target; V-04 is the scene where it matters.
- O2 can make a float function slower: propagating a constant into several products multiplies its rebuilds. A cost-aware search would not have done that, which is an argument for extraction by backend cost (guide §19).
- The cost of `noise3` is calls and constants. That is IRWB-003's territory (inlining, coalescing, constants in registers); rewrite search becomes interesting after inlining, when `gnoise`'s constant offsets become `x + 0.0` and `x − 0.0` shapes.

### What was tricky to build
- Counting only the frame: the host's engine closure counts while a flag is set, and the flag is set only around the pixel loop, so layout, init and the sky table are excluded.

### What warrants a second pair of eyes
- "Fusable" counts the `fadd.s`/`fsub.s` instruction of each pair; it is an upper bound on what contraction saves, since IRWB-011's fusion also requires the two instructions to be fusable without intervening writes.
- Our image's instructions per pixel on X-03 (365,180 at O2) are 21 % above the reference `kernel` image's (302,871 = 121,148,536 / 400; IRWB-011 diary step 2).

### What should be done in the future
- Repeat on IRWB-003's `speed` pipeline with its three backend options once merged: constants in registers and inlining change every share above.

### Code review instructions
- `scripts/03-heat.mjs` (the engine closure, the attribution loop); `various/03-heat.json`.

### Technical details
- Lowering took 15.0 s (r0) and 16.6 s (O2); rendering X-03 36.6 s and 20.4 s, V-04 11.6 s and 5.5 s.

## Step 4: The guide: a draft, a second reading, revisions, and the upload

This step wrote the sketch guide (design-doc 01), reread it whole as its reader, recorded the problems before revising, fixed them, and uploaded it. The guide is 707 lines in five parts: the system parts (value trees, `Tx` provenance, the gate, rules with evidence, SSA, the backend, the measured target), the background from scratch (rewriting and phase ordering, e-graphs, extraction, explanations, rule discovery, superoptimization, related work), the design space (seven decisions), experiments E0–E6 with continue and stop criteria, and risks, open questions and connections.

### Prompt Context
**User prompt (verbatim):** see Step 1.
**Assistant interpretation:** Intern-grade, prose with bullets, pseudocode, diagrams, API and file references with line numbers; every number cited; related work only where certain; a second pass as the reader; tasks for the first experiments; related files; upload with the given name and directory.
**Inferred user intent:** The idea preserved in a form someone else can start from.
**Commit (code):** de2fc14 (draft), 0f2b2d5 (section 8), d0e6415 (second pass, tasks, relations); this step's diary and the final edits are in the next commit.

### What I did
- `docmgr doc add --ticket IRWB-010 --doc-type design-doc --title "Sketch guide: rewrite search on SSA and verified rules"`; wrote the guide; section 8 after the measurements of Steps 2–3.
- Second pass: read the guide from the top. Notes before revising:
  1. The summary said "O2 leaves `noise3` unchanged"; O2 removes two statements and leaves its executed instructions identical. Reworded.
  2. "Once per guard instance" in the verifier table is opaque; added the `mul-pow2` example (31 instances) and what a width-transfer argument is (`argumentFor`, `verify.ts:90`).
  3. Section 8 attributed `noise3`'s `fsgnj.s` to call arguments and `gnoise`'s `fsw`/`flw` to the stack as if measured; both are inferences. Now labelled as such.
  4. The explanation example of section 12 was garbled (a sentence about an e-node extraction never chose). Replaced by a two-step explanation with a congruence step: `(x * 1) * 4 = x << 2` by `mul-one`, congruence, `mul-pow2`.
  5. `x * 2.0 → x + x` uses `x` twice: it needs `pure(x)` and pays for both copies in extraction. Added.
  6. Section 21 did not say what the loop would report on V-04; added: the noise family, 70.6 % of the frame in `hash3`, `gnoise` and `noise3`, untouched by any rule.
  7. The IRWB-003 connection said `homes` "keeps constants in registers"; now cites IRWB-003's guide §14 for what it does.
- Replaced the subscript glyph `ᵢ` (U+1D62) in the verifier table with `c_i`, `x_i`, in case the PDF font lacks it.
- docmgr: tasks E0 (checked), E1–E6, the IRWB-003 re-measurement, the guide task; `docmgr doc relate` of seven files to the guide and the guide and diary to the index; WhatFor and WhenToUse in the guide's frontmatter and an overview in `index.md` (written with a python edit, because `docmgr meta update` refused the field: `error updating WhatFor (unknown field: WhatFor)`).
- Upload: `remarquee upload bundle …/design-doc/01-sketch-guide-rewrite-search-on-ssa-and-verified-rules.md --name "IRWB-010 Sketch: Rewrite Search on SSA and Verified Rules" --remote-dir "/ai/2026/11/26/IRWB-010" --toc-depth 2 --non-interactive` → `OK: uploaded IRWB-010 Sketch: Rewrite Search on SSA and Verified Rules.pdf -> /ai/2026/11/26/IRWB-010`. `remarquee cloud ls /ai/2026/11/26/IRWB-010 --long --non-interactive` → `[f]	IRWB-010 Sketch: Rewrite Search on SSA and Verified Rules`.

### Why
- Related work is limited to works whose authors, venue and year I am certain of; Souper is cited as the arXiv preprint it is, and Cranelift's ægraph only for its scope, with a note that it is documented in that project's design notes.

### What worked
- The upload and the listing above.

### What didn't work
- `docmgr doc relate --ticket IRWB-010 --file-note "$D:the sketch guide"` failed with `malformed --file-note value "01-sketch-guide-…mdhe sketch guide"`: in zsh, `$D:t` is the "tail" modifier of a parameter. `${D}:` fixed it.
- `docmgr meta update --doc … --field WhatFor` is not supported (above).

### What I learned
- The reader's likeliest misunderstanding is that rewrite search would speed up `noise3` directly; the guide now says plainly, with numbers, that its cost is calls and constants and that search matters after inlining.

### What was tricky to build
- Keeping the measured, the inferred and the proposed apart in section 8 and Part 3: every inference is labelled, every proposal marked **Proposed**.

### What warrants a second pair of eyes
- The claim that `x * 2.0 → x + x` is exact for every bit pattern is argued, not verified; E2 is where `verifyRule` must confirm it.
- An author's second reading is not an independent review.

### What should be done in the future
- The experiments E1–E6 (tasks). The vault report is deferred to the implementation milestone.

### Code review instructions
- Read the guide's section 8 and Part 4 against `various/02-value-tree-shapes.json` and `various/03-heat.json`.

### Technical details
- Guide: `design-doc/01-sketch-guide-rewrite-search-on-ssa-and-verified-rules.md`, 707 lines.
