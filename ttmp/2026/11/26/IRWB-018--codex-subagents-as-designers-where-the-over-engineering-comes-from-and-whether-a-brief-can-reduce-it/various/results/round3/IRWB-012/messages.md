## 1

I’ll re-read IRWB-012 with the diary skill, cut details that don’t help test or measure the optimization, and commit the revised ticket.

## 2

The old design spent much of its complexity on diagnosing malformed bytecode. I’ll replace the status and output-buffer protocol with a direct `i32` return and Typed’s existing bounds checks, while keeping both workloads, the independent oracle, and the specialization comparison.

## 3

Commit `0985c7fa88ad10c3a2eff682b9522c5869026cd7`

- Replaced the output buffer, status codes, and duplicate bounds guards with a direct `i32` result and Typed’s native bounds checks.
- Dropped input-size restrictions and detailed malformed-bytecode rules. Generated input ranges and a single fuel cap bound the experiment.
- Removed the optional decode helper and shrank the frame arrays to fit the fixtures.
- Removed bytecode that initialized locals already zeroed by Typed.
- Replaced the assembler and duplicate encodings with direct conversion of the numbered listings.
- Dropped the separate workbench script and sample JSON scaffolding. Project notes and one Node test cover inspection and validation.
- Trimmed malformed-input cases and removed the padded fuel-boundary program and secondary step threshold.
- Dropped the extra O2 run, aggregate ratio, and code-size report. The comparison uses per-case instruction counts for r0, `speed`, and specialized images.
- Deferred the variant router, hand-written performance ceiling, and specializer implementation recipe.
- Condensed the research references and implementation sequence.
