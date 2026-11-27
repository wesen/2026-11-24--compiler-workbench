# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

- Design for classifying edit records as local (verified, fact-guarded), structural or other, with static and executed instruction weights.
- `src/typed/edit-classes.ts` (classifier), `tools/edit-classes.mjs` (corpus census), `tests/typed/edit-classes.test.mjs`. `src/typed/analyses.ts` exports `IMPURE` so the classifier's purity guard matches `isPure`.
- Results: O2 local 17.0 % of edits (verified 53.2 % of local), speed 6.8 % (verified 54.4 %); no edit cites a rule. Report in `report/01-…`.
