# Rubric: round R2 research designs ("what compiler work would make Tix best in class?")

Each document in this pack answers the same brief (`brief.md`). Each comes with its author's diary and experiment scripts in `doc-X/`.

The documents' authors are anonymous. Do not guess who or what wrote a document, and do not let writing style stand in for substance.

Read the brief, then every document in full, before scoring any. Score each document on its own against the brief, with the same standard for all. Quote the passage for every score below 6 and for every error you list.

## Scores (0–10 each; higher is better unless stated)

**Ingenuity.** Non-obvious mechanisms that exploit what is specific to Tix:
- an exactly specified f32 meaning;
- index notation;
- every transformation a checked pass;
- a GPU available for experiments.

A mechanism counts when it would not occur to a competent compiler engineer applying the usual playbook.

**Creativity.** Originality and range of the proposals, measured by their distance from the standard ML-compiler playbook (Halide, TVM, Triton, XLA, polyhedral tiling, autotuning). A familiar technique counts only for what the document says about it that is new here.

**Scientific depth.** The theory is correct, advanced where it needs to be, and stated precisely: definitions, invariants, proofs or proof sketches, error bounds. The literature is used correctly and connected to the proposals.

**Evidence.** The experiments are designed so that they could refute the idea. Their results are reported, negative ones included, and can be reproduced from the scripts in the ticket. Deduct for claims that rest on no experiment where one was feasible.

**Correctness.** Check at least five citations, using the web: that each exists and says what the document says it says. Check at least three technical claims (about CUDA, floating point, or the repository described in the brief). List every error you find with a quote, and deduct for each. Also deduct for a novelty claim when you find prior art the document missed; name the prior art.

**Grounding.** Feasibility in this repository and framework: the document says what each proposal needs from the framework, and the staged plan is ordered by dependency and evidence.

**Padding** *(0–10, lower is better)*. Generic material: standard techniques listed with nothing new said, machinery without a motivating use, repetition, and length that adds no information.

**Overall.** If this document's plan were followed, how much closer would Tix be to best in class, as the document defines it? Also say whether that definition is a good one.

## Also report per document
- `best_ideas`: the three most original ideas, one line each, with a short quote.
- `novelty_check`: for each idea the document calls new, whether you found prior art, with a reference.
- `errors`: each error found, with a quote and the correction.
- `would_fund`: which one proposal you would fund first, and why (two sentences).

## Output
A JSON array, one object per document:

```json
{
  "doc": "doc-A",
  "scores": {
    "ingenuity": n,
    "creativity": n,
    "scientific_depth": n,
    "evidence": n,
    "correctness": n,
    "grounding": n,
    "padding": n,
    "overall": n
  },
  "best_ideas": [...],
  "novelty_check": [...],
  "errors": [...],
  "would_fund": "...",
  "notes": "two sentences"
}
```

Then a ranking of the documents by overall score, with one sentence per document saying why.
