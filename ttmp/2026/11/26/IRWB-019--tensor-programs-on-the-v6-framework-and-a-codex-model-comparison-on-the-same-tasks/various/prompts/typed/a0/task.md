## Your task (A0): what share of the optimizer's edits are local value rewrites?
Research programme A rests on a hypothesis nobody has measured: if most of the value edits O2 and `speed` make are local rewrites (a small expression replaced by an equal one), a function's equivalence could be assembled from per-rule proofs instead of a sampled meaning check (`ttmp/2026/11/25/IRWB-006--...`, `ttmp/2026/11/26/IRWB-008--...` and `IRWB-010--...` describe verified rules and the exact checks built on them).

- **Classify every edit** that the O2 and `speed` pipelines make on the corpus, using the correspondence and the edit records the framework keeps:
  - **local rewrite:** a value replaced by an equal one, citing or matching a rule;
  - **structural:** control flow, loop-invariant motion, inlining, unrolling, register allocation;
  - **other.**

  Define each class precisely enough that the classification is reproducible, and say how you decide the borderline cases.
- **The share** per pass, per pipeline and per project, by edit count and by the instructions the edits affect.
- **Of the local rewrites,** what share already cites a verified rule, and which rules or rule shapes would cover most of the rest.
- **The classifier is a tool,** callable by other code, with a test, so later stages can rerun it.

## Measure and report
- the classification method and its definitions;
- the tables: per pass, per pipeline, per project;
- the verified-rule coverage of the local rewrites, and the rules that would raise it most;
- what the numbers mean for programme A (proof by rules instead of sampling), with the limits of the measurement;
- the framework changes, if any, each with its reason.

## Final message
- the ticket, design and report paths;
- the headline shares (local, structural, other) for O2 and `speed`;
- the verified-rule coverage of local rewrites;
- the framework changes;
- the last commit hash.
