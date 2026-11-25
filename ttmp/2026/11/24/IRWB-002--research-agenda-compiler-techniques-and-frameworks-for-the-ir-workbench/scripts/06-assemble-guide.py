#!/usr/bin/env python3
"""One-off assembly step used while drafting the guide (kept for traceability).

The guide was written in chunks. This script appended the last chunk (workstreams F-I and
Part 3), then spliced in the items added after the scope note "cover compiler research
broadly, with Candela as one workload" (D7, H5, I4, I5, workstream J), and updated the
counts and tables that refer to the item list. Every replacement must match exactly once.

Usage: python3 06-assemble-guide.py GUIDE.md CHUNK_DIR
"""
import sys
from pathlib import Path

guide, chunks = Path(sys.argv[1]), Path(sys.argv[2])
text = guide.read_text().replace("<!-- CONTINUE -->\n", "") + (chunks / "chunk5.md").read_text()


def once(old, new):
    global text
    assert text.count(old) == 1, (text.count(old), old[:60])
    text = text.replace(old, new)


once("## Workstream E: specialization, staging and Candela",
     (chunks / "ins_d7.md").read_text() + "## Workstream E: specialization, staging and Candela")
once("## Workstream I: research tooling",
     (chunks / "ins_h5.md").read_text() + "## Workstream I: research tooling")
once("# Part 3: Roadmap and assignments",
     (chunks / "ins_ij.md").read_text() + "# Part 3: Roadmap and assignments")

# counts
once("a catalogue of 41 research work items in nine workstreams",
     "a catalogue of 54 research work items in ten workstreams")
once("The second is to lay out the work ahead: 41 concrete research items",
     "The second is to lay out the work ahead: 54 concrete research items")
once("The agenda has 45 items in nine workstreams.",
     "The agenda has 54 items in ten workstreams. It covers compiler research broadly: "
     "representations, rewriting, analysis, verification, specialization, compiler "
     "infrastructure, loops, code generation, tooling and language design. Candela and the "
     "corpus are the workloads on which items are measured; they are not what the agenda is about.")
once("   I research tooling: measures all of the above\n",
     "   I research tooling: measures all of the above\n"
     "   J languages and IR design: what the source and the compiler's own languages could be\n")

# register allocation: the alternatives named in the scope note
once("- **A yardstick.** For functions with a handful of intervals",
     "- **Allocation on SSA form.** The interference graph of a program in SSA form is chordal, "
     "so it can be coloured optimally in linear time, and spilling can be decided before "
     "colouring. With A1's view lowered into `rv32.mir`, this is a third allocator to compare.\n"
     "- **PBQP.** Allocation as a partitioned boolean quadratic problem gives each interval a "
     "cost vector over registers and each pair a cost matrix; irregular constraints (an "
     "argument register here, a callee-saved one across that call, a preference between two "
     "move-related intervals) become entries, and a reduction-based solver handles them "
     "uniformly. It is the natural form once f32 adds a second register class.\n"
     "- **A yardstick.** For functions with a handful of intervals")
once("**Size** M to L per part · **Depends on** A5 for the later parts\n\nFour separable pieces.",
     "**Size** M to L per part · **Depends on** A5 for the later parts\n\nSix separable pieces.")

# J5 wording
once("so inserting a statement early in a function renumbers nothing today only because ids "
     "are never reused; across *source edits* every id after the edit point changes, and",
     "per function. A pass never renumbers anything, but after a *source edit* every id "
     "allocated after the edit point in that function changes, and")
once("entities of unedited functions keep their ids.",
     "entities of the edited function that the edit did not touch keep their ids.")

# autotuning in F5
once("*Generated candidates.* Any generator",
     "*Autotuning.* The nine backend options and every pass parameter form a small "
     "configuration space. Sweeping it per project (or per function) is the simplest search "
     "there is, and its result is a strategy file.\n\n*Generated candidates.* Any generator")

# roadmap tables
once("B4, E4, D4, C4, C6, F3, A6, B5, G3, H2 (colouring, yardstick), H4 (compression) |",
     "B4, E4, D4, D7, C4, C6, F3, A6, B5, G3, H2 (colouring, SSA, PBQP, yardstick), "
     "H4 (compression), H5, I5, J2, J3, J4, J5 |")
once("F5, F6, G2, D5 | at least one", "F5, F6, G2, D5, I4, J1 | at least one")
once("| Throughput | workstream F, D1 | D1 (cache the origin's outcomes) | F1, F2, F4, F3 |",
     "| Throughput | workstream F, D1, I5, J5 | D1 (cache the origin's outcomes) | "
     "F1, F2, F4, F3, J5, I5 |")
once("| Assurance | workstream D, C5 | C5 (`typed.ranges-hold`) | D2, D3, D4, D5, D6 |",
     "| Assurance | workstream D, C5, I4 | C5 (`typed.ranges-hold`) | D2, I4, D3, D4, D5, D6, D7 |")
once("| Rules and equality | workstream B, I2 | B1 (`simplify` from a table) | B2, B3, B4, B5 |",
     "| Rules and equality | workstream B, I2, J2, J4 | B1 (`simplify` from a table) | "
     "B2, B3, J2, B4, B5, J4 |")
once("| Candela | workstream E, A6, C6, B6 | H4's duplicate-function count at the IR level | "
     "E1, E3, E2, E5, E4 |",
     "| Specialization and staging | workstream E, A6, C6, B6, J1 | H4's duplicate-function "
     "count at the IR level | E1, E3, E2, E5, J1, E4 |")
once("| Backend and loops | A5, workstreams G and H | G1 (rotation) | H2, A5, H1, H3, G2, G3 |",
     "| Backend and loops | A5, workstreams G and H, J3 | G1 (rotation) | "
     "H2, A5, H1, H3, G2, G3, H5, J3 |")
once("| G, H | Cooper and Torczon",
     "| I, J | Zeller, \"Simplifying and Isolating Failure-Inducing Input\" (2002); Bravenboer "
     "et al., \"Stratego/XT 0.17\" (2008); Rompf and Odersky, \"Lightweight Modular Staging\" "
     "(2010); Ragan-Kelley et al., \"Halide\" (2013); Graefe, \"The Cascades Framework for "
     "Query Optimization\" (1995); Lattner et al., \"MLIR\" (2021) |\n| G, H | Hack, Grund and "
     "Goos, \"Register Allocation for Programs in SSA Form\" (2006); Scholz and Eckstein, "
     "\"Register Allocation for Irregular Architectures\" (2002); Cooper and Torczon")
once("| D | Lopes et al.", "| D | Yang et al., \"Finding and Understanding Bugs in C Compilers\" "
     "(2011, Csmith); Lopes et al.")

guide.write_text(text)
print(len(text), "bytes")
