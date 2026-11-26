# Rubric: research designs (deriving streaming attention by checked rewrites)

Each document answers the same brief (`specs/brief.md`). Score each on its own, with the same standard for all. Verify the mathematics yourself: for every rule, check the stated identity over the reals and its side conditions. Quote the passage for every error and every score below 5.

## Scores (0-5 each)
- **M1 Mathematical correctness:** every rule's identity holds over the reals under its stated side conditions (for example the rescaling factor when a running maximum grows, the treatment of the empty prefix and −∞, the combine's associativity). List each error found, with a quote and the correct statement.
- **M2 Completeness of the derivation:** the sequence of rule applications goes from the plain program to a streaming form that never materializes the N×N matrices, with no step left implicit.
- **M3 The new construct:** the IR extension (for example a reduction over a user-supplied associative combine with a tuple state) has precise semantics, states what algebraic properties it requires and how they are established, and defines its f32 meaning (order, rounding).
- **M4 Checking:** each step is assigned an exact argument, a tolerance check, or both; the document says where f32 results change and why; the plan is sound (it does not accept a step on evidence that cannot detect its likely errors).
- **M5 Generality:** the claims about which other programs the rules reach, and which they fail on, are correct and specific.
- **M6 Experiment:** a falsifiable hypothesis, a primary metric, a refutation criterion, and a design that can be run on the GB10 with the stated baselines.
- **M7 Insight:** content beyond restating FlashAttention: a rule set or construct that generalizes, a non-obvious side condition, a checking idea.

## Also
- `errors`: a list of mathematical or factual errors, each `{ "quote": "...", "problem": "...", "severity": "minor"|"major" }`.
- `over_engineering` 0-10: material beyond what the question needs (designs for unrelated stages, unrequested machinery, measurement beyond the stated metric).
- `overall` 0-10: how well the document would let a team run this research.

## Output
A JSON array, one object per document: `{ "doc": "doc-A.md", "scores": {"M1": n, ..., "M7": n}, "errors": [...], "over_engineering": n, "overall": n, "quotes": {"M1": ["..."], ...}, "notes": "one or two sentences" }`.
