# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Design committed (pre-back-edge loops merged; attribution tool); attributeSteps/attributeOrigins in src/typed/attribute.ts with tests/typed/attribution.test.mjs; loopsOf merge fix measured on bytecode-vm: speed now 6382/5710 vs r0 7678/6874

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-g-h-irwb-034-e/src/typed/analyses.ts — the same-header loop merge
- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d1-g-h-irwb-034-e/src/typed/attribute.ts — the attribution tool

## 2026-11-27

Measured and reported: bytecode-vm speed 9286/8218 -> 6382/5710 (r0 7678/6874); corpus totals O2 1124912 -> 1107836, speed 892944 -> 877151; only regex-nfa also changed (improved); parity 100/100 on both; typed/framework/workbench tests 0 fail; final report and diary written
