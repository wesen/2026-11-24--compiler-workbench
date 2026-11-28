---
Title: Spike report
Ticket: IRWB-051-A
Status: active
Topics:
    - framework
DocType: analysis
Intent: long-term
Owners: []
RelatedFiles:
    - Path: repo://tests/framework/transformation-drivers.test.mjs
      Note: Corpus parity and cache checks
    - Path: repo://ttmp/2026/11/27/IRWB-051-A--one-pass-runner-with-two-drivers/scripts/01-measure-drivers.mjs
      Note: Application timings and line counts
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:26:09.010285034-05:00
WhatFor: ""
WhenToUse: ""
---

# Spike report

## Recommendation

Use one runner with two drivers for same-IR passes with pure synchronous analyses. The deciding measurement is the size of the synchronous manager entry. `analyseSync` is **7 nonblank lines**, including its signature and braces, with one executable forwarding line into the **107-line shared analysis lifecycle**. It duplicates **zero lines of cache lookup, validity checks, record construction, history insertion or event reporting**. `preserveSync` is 9 lines and forwards into a 123-line shared transfer lifecycle. The two drivers plus their typed yield helper are 36 lines and are used by both the pass runner and the manager. The complete manager diff adds 59 lines and removes 13, including both analysis and transfer. The synchronous paths require context-free callbacks and skip the asynchronous context drain and pending-work join.

A shared specification with two thin runners would still need that synchronous query and transfer path. It would also express the order of eligibility, preparation, checks and publication in two places. The prototype's timing ranges overlap for all three workloads, so the evidence supports the shared runner on bookkeeping and acceptance logic rather than on speed.

## Timing

Median milliseconds per application, shown as CPU / wall. Each workload reused the same input and rotated the three modes through one warm-up rotation and two measured rotations. Batches ran for at least 30 ms of process CPU time to amortize clock granularity. Each batch had its own manager, so repeated uses within it could reuse records. The benchmark checked that every application changed the input.

| Workload | Current runner | Prototype sync | Prototype async |
| --- | ---: | ---: | ---: |
| Tix attention, coordinator's always-accept timing gate | 2.472 / 7.419 | 2.168 / 7.109 | 2.077 / 5.826 |
| Tix attention, sampled meaning gate | 23.191 / 100.100 | 21.431 / 73.505 | 21.857 / 84.929 |
| Typed constants, sampled meaning and preservation audit | 21.003 / 91.135 | 18.188 / 72.541 | 20.426 / 63.443 |

The run prints all six samples per mode. For the coordinator's Tix timing gate the CPU ranges were 1.683–14.666, 1.870–2.742 and 1.423–2.429 ms. An initial wall-only trial had wide ranges across all modes. The coordinator check measured 2.518 ms locally against 0.562 ms in its recorded baseline. Timings here include program work, garbage collection, and measurement overhead. They do not establish a reliable sub-millisecond overhead bound.

Both Typed prototype modes use the existing differential specification through the local evaluator. The legacy Typed runner still wraps that check in its full manager contract. The Typed timings therefore compare complete applications, including the different evidence packaging. The legacy call also uses the shared manager implementation in this checkout. The two Tix measurements each use the same gate in all modes.

## Reproduction and validation

From the repository root on Node v24.18.0.

```sh
npm run build
npm run check
node tools/build-site.mjs
node ttmp/2026/11/27/IRWB-051-A--one-pass-runner-with-two-drivers/scripts/01-measure-drivers.mjs
node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check
node --test tests/framework/transformation-drivers.test.mjs
```

The coordinator script printed `no differences`. The TypeScript build, no-emit check and browser site build completed. The site included 50 projects and 17 chapters.

The manager line delta is reproducible with
`git diff --numstat 0d255f7 3c0db3b -- src/framework/contracts/analysis-manager.ts`.

The suite run used two Node workers and explicit files. In Bash, the command was

```bash
for suite in typed framework workbench stdlib tensor; do
  files=()
  for file in tests/"$suite"/*.test.mjs; do
    [[ $file == *-gpu.test.mjs ]] || files+=("$file")
  done
  node --test --test-concurrency=2 --test-reporter=tap "${files[@]}"
done
```

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Typed | 186 | 0 | 2 |
| Framework | 303 | 0 | 0 |
| Workbench | 24 | 0 | 1 |
| Stdlib | 7 | 0 | 0 |
| Tix, GPU files excluded | 45 | 0 | 0 |

The three skips are existing opt-in Candela tests. The 60 added tests all passed: six Tix modules, 50 Typed projects, and four focused tests for shared analysis identity and invalidation, rejection before publication, pure transfer and async cache-miss refusal. The corpus tests also compare correspondence, edit details, preservation outcomes and sampled evidence where a candidate changes. No existing test assertions changed.

Typed constant propagation was selected because the suggested LICM and BCE both declare `preserves: []` in this checkout. The prototype reuses the existing Typed transaction and Tix kernel. It adds no domain-specific analysis cache or transaction machinery. Both production entry points remain available for baseline and parity checks.

## Later

- Migrate callers and the strategy bridge after choosing a runner. The prototype does not execute synchronous strategy plans.
- Extend synchronous support to manager contract transactions and dependent or effectful analyses when required by a migration.
- Generalize the transformation type beyond same-IR native passes when a lowering moves.
