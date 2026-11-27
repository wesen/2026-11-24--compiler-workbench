---
Title: Deriving streaming attention by checked rewrites
Ticket: IRWB-021-O
Status: active
Topics:
    - compiler
    - ir
    - verification
    - research
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: 'Research design (no implementation): can a compiler derive FlashAttention from the plain Tix attention program by rewrites whose correctness is local and mechanical? Four rules, one new IR construct (a fold over a declared monoid), a measured f32 story, a generality map, and a falsifiable experiment on the GB10.'
LastUpdated: 2026-11-26T00:00:00-05:00
WhatFor: 'Entry point for IRWB-021-O: what was decided, where the design is, and what would refute it.'
WhenToUse: Before working on the Tix fold, a tensor rule verifier, or the Tix meaning contract's tolerance relation.
---

# Deriving streaming attention by checked rewrites

## Overview

The question: attention written the plain way in Tix materialises an N×N score matrix; FlashAttention computes
the same function in one pass with a running maximum, normalizer and output. Can a **compiler** derive the second
from the first as a sequence of rewrites, each checked, with a local and mechanical correctness argument?

The answer this ticket designs (and does not implement):

- **four rules** — `Split`, `Factor`, `Fuse`, `Rebase` — five applications from the program as written to the
  streaming form;
- **one new IR construct** — a `fold` statement over a declared `monoid`: a reduction whose state is a tuple of
  tensors (including an `f32[D]` numerator), whose combine is user-supplied, and whose body is a single-assignment
  region with local temporaries; its f32 meaning is the plain left fold in increasing lexicographic index order;
- **per-rule checking** — every rule carries a real-algebra proof; `Fuse` is additionally bit-exact in f32 and
  checked structurally; `Split`, `Factor` and `Rebase` are checked with a tolerance relation scaled by the
  program's own term magnitudes, because the raw relative drift is dominated by cancellation (measured);
- **a falsifiable experiment** on the GB10: DRAM bytes and time of the derived kernel against the unfused
  lowering, a hand-written FlashAttention-2, the nested (unblocked) form, and a one-block exactness control.

Everything is in `design/01-deriving-streaming-attention-by-checked-rewrites.md`. No code was written except two
CPU-side probes under `scripts/`, whose outputs are in `various/`.

## Key Links

- **Design**: [design/01-deriving-streaming-attention-by-checked-rewrites.md](./design/01-deriving-streaming-attention-by-checked-rewrites.md)
- **Brief (verbatim, the scope of record)**: [reference/01-ticket-brief.md](./reference/01-ticket-brief.md)
- **Diary**: [log/01-diary.md](./log/01-diary.md)
- **Evidence**: [various/01-f32-and-exact-algebra-probe.txt](./various/01-f32-and-exact-algebra-probe.txt),
  [various/02-derivation-stages-probe.txt](./various/02-derivation-stages-probe.txt)
- **Probes**: `scripts/01-f32-and-exact-algebra-probe.mjs`, `scripts/02-derivation-stages-probe.mjs`
  (`node <path>` from the repository root, standard library only)
- **Related Files**: See frontmatter RelatedFiles field (the design doc carries the six framework files it leans on)
- **External Sources**: none

## Status

Current status: **active** — the design is complete as a document; nothing here is implemented. The implementation
follow-ups are listed in the design's §11 ("Later") and in [tasks.md](./tasks.md).

## Topics

- compiler
- ir
- verification
- research
- performance

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- `design/` — the design document
- `reference/` — the ticket brief, verbatim
- `scripts/` — the two probes (the only code in this ticket)
- `various/` — probe outputs
- `playbooks/`, `sources/`, `archive/` — unused in this ticket
