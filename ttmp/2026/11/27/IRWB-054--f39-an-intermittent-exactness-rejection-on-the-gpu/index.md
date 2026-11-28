---
Title: 'F39: an intermittent exactness rejection on the GPU'
Ticket: IRWB-054
Status: active
Topics:
    - compiler
    - ir
    - tensor
    - gpu
    - verification
DocType: index
Intent: long-term
Owners: []
ExternalSources: []
RelatedFiles:
    - Path: repo://tools/cuda-remote.mjs
      Note: the fix — retry a job whose ssh connection sshd dropped
    - Path: repo://tests/tensor/schedule-gpu.test.mjs
      Note: line 35, the check that failed once in four runs
    - Path: repo://src/tensor/cuda-contract.ts
      Note: the lowering check that reported accepted false
    - Path: repo://src/tensor/cuda-runtime.ts
      Note: one job per forced mode, three ssh steps each
Summary: 'F39 is not a race in the tiled contraction: sshd drops connections past MaxStartups and the runner turned the dropped job into accepted:false. Fixed in tools/cuda-remote.mjs by repeating the job; 35/72 checks failed before, 0/2152 after.'
LastUpdated: 2026-11-27T23:08:00.000000000-05:00
WhatFor: ""
WhenToUse: ""
---

# F39: an intermittent exactness rejection on the GPU

## Overview

`tests/tensor/schedule-gpu.test.mjs:35` (every tiled variant of the feature contractions is exact, each variant
forced) failed once in four runs of the GPU suite, on the `batched` contraction, with `accepted: false`. The
suspicion was a race in the emitted CUDA, which would undercut every exactness claim the lowering makes.

It is not. The kernel is race-free and deterministic (`compute-sanitizer` clean on all four variants; 800 repeats of
one case give one bit pattern, equal to the interpreter's; the check's cases are generated deterministically). sshd on
the GPU machine accepts ten unauthenticated connections at a time (`MaxStartups 10:30:100`) and drops the surplus;
each GPU job opens three connections and a whole suite opens dozens. The runner reported the dropped job as a failure,
and `checkCudaLowering` reports any failure of the evidence as `accepted: false`.

The fix is in `tools/cuda-remote.mjs`: a step whose connection was dropped is repeated as a whole job in a fresh
remote directory (six attempts, jittered doubling backoff), a step whose command failed is not. 35 of 72 checks failed
under suite concurrency before, 0 of 2 152 after; 288 of 288 jobs failed before the fix and 0 of 288 after it, with
339 dropped connections absorbed. Start with the report, then the design doc.

## Key Links

- **Related Files**: See frontmatter RelatedFiles field
- **External Sources**: See frontmatter ExternalSources field

## Status

Current status: **active** — the defect is fixed and accepted; the measurements are in the report.

## Topics

- compiler
- ir
- cuda
- verification

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
