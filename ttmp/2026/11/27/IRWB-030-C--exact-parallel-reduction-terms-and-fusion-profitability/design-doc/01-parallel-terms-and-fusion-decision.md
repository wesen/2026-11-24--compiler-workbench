---
Title: Parallel terms and fusion decision
Ticket: IRWB-030-C
Status: active
Topics: [tensor, gpu, verification]
DocType: design-doc
Intent: long-term
---

# Parallel terms and fusion decision

The input domain is the existing checked Tix core and CUDA calling domain, including empty extents and finite inputs. Preserve the current f32 meaning, including ordered accumulation and NaN class comparison. The unfused emitter stays unchanged.

For block-mode row-scalar statements, identify independent reduction bodies from the IR. Threads compute terms into a row buffer, synchronize, and thread 0 folds them in increasing index order. The simplest alternative, retaining the serial loop, avoids barriers and storage but serializes expensive terms. Restrict staging to an ordinary single-axis reduction without nested reductions; the existing scalar path handles everything else. Term storage must participate in the existing shared-memory capacity and scratch fallback calculation. No reassociation or changed rounding is permitted.

Keep legality in the existing IR planner. Evaluate profitability against the stage-2 lowering with measured full-size timings, and choose only a rule supported by the measurements; a blanket fusion rule is simpler but already known to regress. Record refusals and the evidence. The existing GPU exact contract checks the final emitted source. Benchmark and test both reduction placements and the corpus; record uncertainty where timings overlap noise.

The simplest implementation reuses the existing scalar writer and row-buffer machinery rather than introducing another IR. No framework change is anticipated; any required change is a primary result. Omitted: tree reductions, tiling, fast intrinsics and autotuning, as directed. Later: general nested or multi-axis term staging.
