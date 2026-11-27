# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Threshold widening in typed.ranges v2 (guard constants as widening thresholds; the framework solver hands widen the region context), strength emits shru, two verified shift-mask simplify rules with a shift guard, bce removes bounds checks dominated by an identical check and knows constant lengths, simplify after strength in speed, attributeSteps gains a step limit. Regex 6933->6587 (reference 6628), LZ 156782->154700 (reference 156405), chess 10038193->9535352 (reference 10827760), corpus speed total -2.04%, no regressions; parity 8286/8286.

### Related Files

- /home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/d2-g-h-irwb-037-e/src/typed/analyses.ts — typed.ranges v2 widenTo and guard constants
