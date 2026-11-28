---
Title: Diary
Ticket: IRWB-051-A
Status: active
Topics:
    - framework
DocType: log
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: ""
LastUpdated: 2026-11-27T20:20:09.878499161-05:00
WhatFor: ""
WhenToUse: ""
---

# Diary

## 1. Design

Read Phase 3, R3 K1/K3/K5 and the merged lifecycle, verification notes, and the current pass and manager code. Selected constant propagation because LICM and BCE declare no preserved facts in this checkout. The experiment will share the manager lifecycle and compare the result with the current entry points.

Node reports v24.18.0. Docmgr created the ticket and design and log documents in the requested date directory. Offline npm install hit EPERM in the esbuild install script's child process. `npm ci --offline --ignore-scripts` installed the locked dependencies successfully.

## 2. Prototype

The runner yields deferred calls and receives failures at the yield, so both drivers share the order of preparation, checking and publication. The analysis manager had an existing effects module. The new driver lives in `effect-driver.ts` and handles deferred calls independently of those semantic effect definitions.

The first focused test run failed at the Node test file boundary in the sandbox. The escalated run exposed a test assumption about the store's initial generation. The test now checks the actual head revision and retained revisions. The targeted refusal, pure transfer and async-cache-miss tests passed with `--test-isolation=none`.

The coordinator check reported no differences, and the site build succeeded. The first benchmark showed high wall-clock spread. The committed benchmark measures process CPU time as well, with rotated batches to distribute first-position cost.
