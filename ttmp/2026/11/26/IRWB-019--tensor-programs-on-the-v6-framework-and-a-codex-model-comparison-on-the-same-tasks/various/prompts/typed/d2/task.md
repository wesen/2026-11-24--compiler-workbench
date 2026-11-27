## Your task (D2): missed optimizations, found from provenance
After `speed`, the regex matcher runs 8,040 RV32 instructions against the reference compiler's 6,628, and the LZ compressor 157,682 against 156,405, while chess search (10.08M) already beats the reference (10.83M). 18 of the simplifier's 27 rules never fire on the corpus.

- **Close the loop from hot code to new rules:** find hot executed instructions whose provenance shows no rule or pass improving them, look for the code shapes that account for the gap (the regex gap first), propose candidate rules or pass changes, verify each rule with the repository's rule verification, and add the ones that pay.
- **The attribution of executed instructions to compiler decisions** was built by the previous stage (D1, merged in this repository's history; read its ticket). Reuse it, and extend it where it falls short.
- **Every added rule is verified,** and every pass change is checked as passes are now.
- **New approaches are welcome,** for example rule discovery guided by the gap to the reference compiler. Report what worked and what did not.

## Measure and report
- the method, and the shapes found, with their instruction counts;
- each rule or pass change added, its verification, and what it gained;
- instructions per corpus project under O2 and `speed`, before and after, and against the reference compiler;
- the framework changes, each with its reason;
- which results you measured and which you only argued.

## Final message
- the ticket, design and report paths;
- the rules and pass changes added, with their gains;
- regex, LZ and chess instructions under `speed`, before and after, and the corpus totals;
- the framework changes;
- the last commit hash.
