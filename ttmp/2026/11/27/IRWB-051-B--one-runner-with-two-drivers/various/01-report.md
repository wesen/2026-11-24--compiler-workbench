---
Title: Keep one runner with two drivers
Ticket: IRWB-051-B
Status: review
Topics: [framework]
DocType: analysis
---

# Keep one runner with two drivers

A synchronous Typed pass can use the same cache, record IDs, invalidation epochs and evidence events as an asynchronous pass. That decides the design question. The manager needed **27 physical lines specific to synchronous execution** and **zero copied lines of cache lookup or record construction**. Two runners would each have to order eligibility, preparation, checks, rollback and publication for the same result.

## What the experiment exercised

The generator drives native endomorphisms. Its analysis requests carry two ways to obtain the same record. The drivers send the record or throw the error back into the generator. Both paths use the existing correspondence builder, declared-write check and F33 publisher. Input requirements and eligibility precede preparation. Output checks and audited preservation precede publication. The relation describes the claim being sampled. The ported Tix check receives that relation directly.

Tix inline matched its native runner on all six corpus modules. Typed constprop matched the existing async runner on all 50 projects at r0, with nine changed revisions and 41 identities. The test also compares the edit count, change set, correspondence, domain report and preservation outcomes. It runs real differential gates on changed revisions and audits all three constprop preservation claims. A separate test exercises cold sync → async hit, invalidation → cold async → sync hit, and refusal of a promise on a synchronous miss. A false preservation claim leaves the input as head and the candidate analysis invalid. On the async path the additional deferred manager contract records a rolled-back execution.

## Cost

Medians in milliseconds per application on Node 24.18.0. Each fixture used the oracle's batch size of 50 applications, repeated in all six possible driver orders to balance ordering effects. An untimed call first verified all three produced the same changed revision. Timings used a trivial gate to isolate framework and analysis cost. The corpus equivalence test used the domain gates.

| Fixture | Stock | Shared runner, sync | Shared runner, async |
| --- | ---: | ---: | ---: |
| Tix attention, inline | 1.857 | 1.948 | 2.034 |
| Typed constants, constprop, cold manager and audited preservation | 11.064 | 6.765 | 6.329 |

The synchronous Tix median differed from stock by 0.091 ms. Its six batches ranged from 1.516 to 2.931 ms, overlapping stock's 1.589 to 2.662 ms. These shared-host measurements do not resolve a small dispatch penalty. The Typed stock runner tries transfer before recomputing each claim. The three preserved analyses have no transfer rule, so the prototype goes straight to recomputation. Its lower time includes that difference and cannot be attributed to the generator.

A second invocation after the suites finished gave attention medians of 2.925, 2.988 and 3.038 ms in stock/sync/async order. Typed medians were 14.091, 10.687 and 8.195 ms. The stock timings moved substantially between runs.

The size probe counts declarations, braces and comments. The public sync method takes nine lines and its cold execution branch takes 18. The shared lookup and record builder occupy 97 lines. Ten lines handle async cold execution and draining. Both cold branches invoke the definition with an immutable subject, freeze its answer, call the same finalizer, and close their frame. Cache validity, permission replay, history, validation, record IDs and events each have one implementation. A sync miss permits evidence recording and requires an immediate answer from an effect-free leaf analysis. An eligible warm record uses the manager's ordinary dependency checks.

## Reproduce from the worktree root

```sh
ticket=ttmp/2026/11/27/IRWB-051-B--one-runner-with-two-drivers
npm run build
node --test tests/framework/transformation-drivers.test.mjs
node "$ticket/scripts/02-measure.mjs"
node "$ticket/scripts/03-size.mjs"
node ttmp/2026/11/27/IRWB-039--framework-v7-honest-evidence-atomic-publication-one-runner-and-a-standard-library/scripts/02-baselines.mjs check
bash "$ticket/scripts/01-suites.sh"
npm run check
node tools/build-site.mjs
```

The baseline check printed `no differences from …/various/baselines/main.json`. Its independent informational timing was 4.149 ms against the recorded 0.562 ms. The baseline compares production callers. The new tests directly compare the prototype. The TypeScript check passed and the site build included 50 projects and 17 chapters.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Typed | 186 | 0 | 2 |
| Framework (includes the four spike tests) | 247 | 0 | 0 |
| Workbench | 24 | 0 | 1 |
| Standard library | 7 | 0 | 0 |
| Tensor, excluding GPU files | 45 | 0 | 0 |

All three skips were pre-existing opt-in Candela checks. No existing assertion changed.

## Later

- Migrate the production callers and strategy interpreter only after review of this spike.
- General manager contracts with asynchronous dependencies use the async driver and deferred commit. The synchronous driver supports immediate domain gates.
- Preservation transfer on the prototype and projection-based edit kernels need migration coverage beyond these two native kernels.
- Both ports express exact relations. No tolerance pass was requested or measured.
