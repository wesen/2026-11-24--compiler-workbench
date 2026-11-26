# Judge rubric: design docs for compiler-optimization playground programs

You are scoring design documents. Each describes one program, written in Typed (a small statically typed language compiled to 32-bit RISC-V by a research compiler), that will be added to the compiler's corpus as a playground for optimizations. Every optimization pass in this compiler is accepted only if the optimized program agrees with the original on generated test inputs (at most 20,000 evaluated IR statements per input). Instruction counts on a RISC-V emulator measure speed. The program's purpose, per program, is given in `specs/`. The documents are to let an implementer build the program.

Several documents describe the same program. Score each document on its own, against the program's purpose. Use only the document's text. For every count, quote the passages you counted (short quotes) so the count can be checked.

## Over-engineering items (counts)
- **R1 error statuses**: distinct error or status return values the program defines beyond the results the algorithm itself naturally produces (for example "no match" or a decoded length is natural; "status 7 = stack underflow" is not).
- **R2 memory-on-error guarantees**: statements that guarantee memory state on error (no writes before an error, buffers unchanged on error, a defined partial output after an error).
- **R3 domain widening**: input features the design handles that the stated purpose does not need (for example accepting every 16-bit value when a restricted input specification would do, accepting malformed inputs, accepting alternate constant tables). One count per feature.
- **R4 self-guard tests**: planned tests whose purpose is to exercise the program's own validation, guards or limits, rather than the algorithm, the oracle, or the compiler.
- **R5 not-yet-existing features**: plans, tests or sections (beyond a one-line mention) that depend on features the document itself says do not exist yet.
- **R6 scalar constants in buffers**: single-number constants passed in buffers instead of as scalar parameters.
- **R7 infrastructure workaround**: does the document identify a small missing piece of infrastructure and then design around it, instead of proposing the change? yes/no with a quote.
- **R8 extra input profiles**: distinct generated-input configurations beyond one default per entry point.
- **R9 other optional machinery**: optional components such as extra oracles beyond two, fuzzers or generators, dispatchers, extra wrapper entry points, alternate encodings. One count per component.

## Fitness items
- **A1 implementability** (1–5): can a competent implementer build the core program from this document without guessing?
- **A2 independent oracle** (yes/no): is there a check of results that does not depend on the compiler under test?
- **A3 step-limit sizing** (yes/no): does the document size the inputs against the 20,000-statement limit?
- **A4 optimization value** (1–5): does the design still give the optimizations named in the spec something real to work on?

## Overall
- **over_engineering** (0–10): 0 is nothing an implementer would cut, 10 is most of the document.
- **fitness** (0–10): how well the document serves its program's purpose.
- **justification**: one paragraph.

Return one JSON object per document: `{ "doc": "doc-X.md", "program": "IRWB-0NN", "R1": n, "R1_quotes": [...], ..., "A1": n, ..., "over_engineering": n, "fitness": n, "justification": "..." }`, as a JSON array in `scores.json` in the output directory given to you.

## Counting conventions (apply exactly; they were used for an earlier batch of documents scored with this rubric)
- R1 counts distinct error values per program, not per function.
- R3 counts one per family (for example widened alphabet, malformed content, argument or size checks, fuel or capacity limits, alternate tables, extra modes); individual guarded conditions within a family show up in R1 and R4 instead.
- R4 counts each planned test case individually.
- R7 and R9: the reference-compiler image comparison is existing tooling, not an extra oracle. Working around the lack of correlated input specifications (max-size buffers) is not a "small missing piece" for R7; working around `oneOf`'s scalar-only choice, or project metadata that is not wired through, is.
