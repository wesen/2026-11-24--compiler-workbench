---
Title: Implementation diary
Ticket: IRWB-033-B
Status: active
Topics:
    - tensor
    - gpu
    - verification
DocType: reference
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T10:04:09.014532792-05:00
WhatFor: ""
WhenToUse: ""
---

# Implementation diary


## Step 1. Design checkpoint

The request is “Build a schedule IR, and make it the compiler.” The primary acceptance path is the public synchronous source function and the asynchronous GPU contract consuming the same schedule. I read stages 3b, 3 and 2, the contract and adapter APIs and the named paper. Node reports v24.18.0. The worktree initially had no dependencies. npm ci --offline installed the six locked packages from cache.

The base imports its plan in two places. Consolidating these paths prevents a checker from validating a different compiler than the public API. The stage 3b gate already forces both branches on tiny differential samples. Review the template specialization and the ordered tail when comparing the new paths.

## Step 2. First working schedules

The schedule artifact retains the resolved function and imported fusion groups. Three native passes partition output and K, give a rectangular accumulator patch to each lane, and stage panels in shared memory. A new third forced gate choice checks tiled contraction members when a row group also has two pre-existing paths.

The TypeScript build succeeded. Script 02 ran the GB10 exact checker and one timed call for each changed corpus program. Matmul, attention and MLP passed and matched the base output hashes. The 64-square block at 512 square took 0.0933 ms. Attention and MLP took 0.533 and 0.383 ms by materializing intermediate statements. The resulting gate reports unfused for those runs. Review the distinction between shape-time launch decisions and the identity of the one global definition.

## Step 3. Sharing whole words and retaining fusion

The 4×4 patch exposed enough independent accumulator chains that the operand distribution became important. Comparing executable schedule revisions showed that staging scalar words alone cost performance. Packing the global loads and fetching contiguous register fragments cut the 512-square time from 0.0885 to 0.0517 ms. An 8×8 patch improved a separate 4096-square trial. A smaller block on the skinny attention value product lost. The report records the five-call series and their inputs.

At commit 1aa3b23 the tiled route materialized every member separately. The phase pass now combines equal-coordinate epilogues into their dot and reuses the original shared/scratch row placement across a contiguous normalization phase. The validator reconstructs live-ins and live-outs. Its critical case is a previously in-place tensor crossing a launch. The new phase imports that tensor from its global buffer before the row computation and exports what the next launch reads. The affine convolution takes a different path, hoisting an invariant input read out of four independent channel folds.

## Step 4. Closing the check on the normal entry point

The public source, runner and checker now share compileCudaPipeline. Its correspondence inventory carries individual folds through unchanged v6 IDs. The framework previously let a caller specify the synchronous gate, so running an individual schedule pass elsewhere could omit the intended check. Pass definitions can now own that check. Both application paths enforce it.

The exact contract requests an aligned panel assignment and checks both tiled block sizes. The packed-load mutant was rejected numerically. Full and clipped transposed panels agreed with the interpreter. The original two successful GPU tests are in scripts/17-first-gpu.log. The build succeeded. A first CPU suite launched while tsc was still emitting and used an older transpose matcher. The matching test failed. The rebuilt suite passed. A timed run and a separate mutation test encountered “Connection closed by 100.117.186.55 port 22”. Other jobs reached the device. The checker now submits the forced route batches in sequence, keeping the original differential's shared in-flight checks. Qualification resumes successful calls by source hash and records one retry for a disconnected public call.

Review the orderCheck evidence, the phase live-in copies and the argument used to preload each templated entry. Scripts 03–15 separate layout effects, clock sampling, short shapes, isolated launches and checking costs.
