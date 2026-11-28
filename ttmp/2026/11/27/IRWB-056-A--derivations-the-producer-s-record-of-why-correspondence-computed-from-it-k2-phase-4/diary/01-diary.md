---
title: Diary
---

# IRWB-056-A diary

1. **Read the ground.** R3's K2 section and the migration step; `Tx.record` and its origins;
   `revisionCorrespondence` (the correspondence Typed rebuilds after the fact); `prepareNative` (the
   two-projection completion that made Tix `inline`'s producer come out `removed`); the A0 tables
   (183 rule matches, 203 and 395 local edits under two policies); F35's coverage vocabulary
   (`partial | nonempty | source | target | both`) in the analysis manager.
2. **Ticket, then a baseline measurement before touching anything** (`scripts/01-correspondence-cost.mjs`):
   O2 over the corpus, gate off, 195 changed revisions; pipeline 20.5 s, today's correspondence 7.4 s.
   (Later three interleaved runs showed that first reading was machine load; see step 9.)
3. **The framework record** (`src/framework/ir/derivation.ts`): `DerivationStep` (`by`, `consumes`,
   `produces`, `premises`, `relation`, `note`); `stepsToCorrespondence` groups steps that share a site into
   entries (premises → `because`, notes joined) and rejects empty sites and false mappings; the runner
   (`prepareNative`) computes the correspondence from the steps whenever a producer recorded any. Decided:
   one step per made/removed entity (not per edit record — rebuilds create entries today but no records),
   and `relation` stays the producer's vocabulary.
4. **Typed writes rule ids** (`tx.ts`, `rules/compile.ts`): `MakeOptions.rule`, `Tx.cite` for the rules that
   fired in a statement field, the citation and the walk's premises (`licensed`) attached to the replace
   record. Corpus count: exactly 183 (fold 43, simplify 140), no other pass cites.
5. **First equality run over O2 passed everywhere** — the steps reproduce `revisionCorrespondence`'s
   entries for every changed revision of every project. The A0-B query first came out 183, not 203: the
   strength pass's fact lives in the made value's origin, not in the replace record. Fix: the record now
   carries the walk's premises (`licensed`), which is also what the ticket asks ("the rule ... and the
   facts it used"). 203 and 395 then both reproduced.
6. **Tix inline** records merges, chains resolved to the final survivor; the correspondence computed from
   them says `merged` into the consumer, where the two-projection completion said `removed`. This is K2's
   finding, so it is the one intentional change to a published correspondence; no test asserted the old
   entry and the Tix baseline records revisions and CUDA, not correspondences.
7. **`tests/typed/rules.test.mjs` B1 updated**: it compares table vs hand-written passes by canonical
   edit records; the table pass's records now cite rules and premises, so the comparison strips the two
   new fields (`uncited`). Nothing else in the suites changed.
8. **The full speed corpus probe found one difference**: `licm-traps rotate`, one entry whose two notes
   were joined in the other order. Cause: today's grouping iterates the after-tables (values, statements,
   blocks, each id-sorted), my steps were in creation order. Fix: `typedPass` orders the published
   derivation as the revision's tables name its products. Speed corpus then: 368 changed revisions,
   9,550 steps, 0 differences (`various/02-speed-corpus-equality.txt`).
9. **The decision point measured properly** (first reading was noise): three interleaved runs per side —
   pipeline medians 9.5 s before and after; the derivation recording is indistinguishable from noise, far
   below the 2× threshold, so no on-demand fallback (and no local terms are stored at all).
10. **Acceptance**: baselines `no differences`; framework 263, stdlib 48, tensor 50 (non-gpu), workbench
    24 + 1 skip, typed 189 + 2 skips, all pass; `npm run check` clean; `build-site` builds; the new tests
    (`tests/{framework,typed,tensor}/derivation.test.mjs`) carry the ticket's numbers.
