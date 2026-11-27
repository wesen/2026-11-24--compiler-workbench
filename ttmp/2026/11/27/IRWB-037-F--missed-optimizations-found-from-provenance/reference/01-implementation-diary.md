---
Title: Implementation diary
Ticket: IRWB-037-F
Status: active
Topics:
    - compiler
    - performance
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T12:41:37.640700608-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary

## Step 1: Baseline, a hot-statement view and a shape census

I measured the three benchmarks again after D1, extended D1's attribution with a view of what is left (the hot
statements of the last revision with their machine instructions and provenance, and the reference image's
instructions per function), and ran a shape census of executed value trees over the corpus. The outcome is three
findings (F1 dominated bounds checks, F2 bcm in no pipeline, F3 constants inside addresses) and a design.

### Prompt Context
**User prompt (verbatim):** "Read the file /home/manuel/code/wesen/2026-11-24--compiler-workbench/ttmp/2026/11/26/IRWB-019--tensor-programs-on-the-v6-framework-and-a-codex-model-comparison-on-the-same-tasks/various/prompts/typed/d2/claude/IRWB-037-F.md and follow it exactly. It is your whole task: it names your git worktree, the standing instructions and the brief. Read nothing else under that IRWB-019 ticket directory."
**Assistant interpretation:** the brief (D2): find hot instructions no rule or pass improves, using D1's attribution; add verified rules and checked pass changes; measure the corpus against the reference.
**Inferred user intent:** close the gaps to the reference compiler (regex, LZ) with evidence-backed changes, and report the method.
**Commit (code):** 1b71d71 — "IRWB-037-F: ticket, design, baseline benchmark and shape census scripts"

### What I did
- `npm ci`, `npm run build` (the worktree had no node_modules).
- `scripts/01-bench-three.mjs` (regex, LZ, chess as their tickets measured them) -> `various/bench-before.json`.
- `hotSites` in `src/typed/attribute.ts`; `--hot N`, `--reference` and comma-separated pass lists in `tools/attribute.mjs`.
- `scripts/02-shape-census.mjs speed --backend tuned` -> `various/census-speed-before.txt`.
- `scripts/03-corpus-measure.mjs` (IRWB-034-G's script plus a reference column) -> `various/corpus-before.json` (about 25 minutes under load 11).

### What worked
- Benchmarks: regex 8,183 / 6,933 (default) / 5,405 (tuned) / 6,628 (reference); LZ 185,876 / 159,079 / 156,782 / 156,405; chess 14,804,396 / 10,038,193 (tuned) / 10,827,760.
- The hot view on regex shows four checks `if (i >=u 9)` dominated by an identical check (346 instructions); on LZ the three checked addresses of the inlined `hash3` in one block, which bcm would merge but no pipeline runs.
- A probe of `speed` with bcm after bce: LZ tuned 156,782 -> 148,250.
- After bcm the hot view shows `caddr(input, ((p + 1) + -1)) + 2` and `input + ((p + 2) << 1)`: constants the backend cannot fold into the load offset.

### What didn't work
- `node tools/attribute.mjs ... --reference` first failed with `TypeError: img.insns is not iterable`: `lowerToImage` returns an artifact, `imageFromCode` a bare image; fixed with `(img.value ?? img)`.
- A heredoc to `ttmp/.../IRWB-037-F*/scripts/...` did not expand the glob in a redirection (zsh: `no matches found`); I use the full path since.

### What I learned
- Regex's 8,040 was with default backend options; with the tuned options `speed` already beats the reference (5,405). The remaining default-option gap is mostly constants rebuilt before each check (`addi rX, zero, 9`), which `homes` removes.
- bcm (IRWB-001, for Candela) is in no pipeline.
- `Tx.rewrite` visits each node once, bottom-up, with the rebuilt children: a rule's output is not revisited, but its parent sees it.

### What warrants a second pair of eyes
- The existing bce case (a dominating `lt`) accepts equal reaching-definition sets as "same value"; that is not sufficient in general (`A; if (c) i = i + 1; B` in a loop). The new case uses a stronger condition; the old one is unchanged and noted under Later.

## Step 2: bce, the reassoc rules and the verifier

Implemented the three changes of the design: bce removes a check dominated by a check of the same index against
a bound no larger; a rule table `reassoc` with three constant-reassociation rules as a table pass; and two
extensions of the verifier so the rules are proofs rather than samples.

### What I did
- `src/typed/passes.ts`: bce's `checkOf`, `sameDefs` (statement order through dominators; every definition reaching
  the second check runs before the first), `dominatingCheck`; the `reassoc` pass.
- `src/typed/rules/reassoc.ts`: `add-add-const`, `shl-add-const`, `add-inner-const`; listed in `RULE_SETS`.
- `src/typed/rules/verify.ts`: symbolic-linear treats a constant variable without an instance as a degree-one
  symbol, evaluates `{eval: add|sub|mul|shl}` templates symbolically, instantiates shift-only constant variables over
  0..31; the structural check no longer counts a constant variable used on the right as an effect.
- `scripts/04-verify-candidates.mjs`, `scripts/06-record-evidence.mjs` (adds the three records to `evidence.ts`).

### What didn't work
- First verification: `shl-add-const` and `add-inner-const` failed structurally: "the variables x are reordered
  without pure: their effects would change order". The right side uses the constant variable `k` as a tree
  (`{ var: 'k' }`), which the effect sequence counted while the left side's sequence skips constant variables.
- Second: `add-inner-const` failed symbolic-linear with `0 + 1·y + 1·x + 1·#c ≠ 0 + 1·y + 1·x + 1·c`: I had keyed
  symbols `#c` while `{ var: 'c' }` on the right is keyed `c`. Keyed both by the name (names are bound once).

### What worked
- With both fixes, all three rules: sound, proof (symbolic-linear; `shl-add-const` over 32 instances of `k`).
