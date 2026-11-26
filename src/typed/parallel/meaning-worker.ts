/**
 * IRWB-004 F4: a worker thread that decides cases of `typed.meaning-kept` for the pool in node-pool.ts.
 *
 * The worker keeps what the pool sent it: function parts by hash (as parsed, frozen records), programs assembled from
 * parts by revision, cases by case set, and the origin's outcome per case. A job names both programs as lists of
 * part hashes, carries the parts and cases this worker does not have yet, and the indices to decide. Each index is
 * decided by `decideCase` with the specification `meaningKept(params)` gives in this realm: the code that decides a
 * case on the main thread.
 */
import { parentPort } from 'node:worker_threads';
import { decideCase, differentialSpec, type Decided } from '../../framework/contracts/differential.js';
import { meaningKept, type Case } from '../evaluate.js';
import type { TypedBlocks } from '../model.js';
import { assembleParts, parsePart, type PartRecords } from '../parts.js';
import { CASE_SETS_MAX, type JobMessage, type ProgramRef, type ReplyMessage } from './protocol.js';

const PARTS = new Map<string, PartRecords>();
const PROGRAMS = new Map<string, { value: TypedBlocks }>();
const PROGRAMS_MAX = 4;
const CASES = new Map<number, Case[]>();
const OUTCOMES = new Map<string, unknown[]>();

function program(ref: ProgramRef): { value: TypedBlocks } {
  let art = PROGRAMS.get(ref.revision);
  if (art) {
    PROGRAMS.delete(ref.revision);
    PROGRAMS.set(ref.revision, art);
    return art;
  }
  // without counters and front end: the evaluator reads records by id and functions by name, which is all a
  // program assembled from its parts has to agree on with the original
  art = { value: assembleParts(ref, h => PARTS.get(h)) };
  PROGRAMS.set(ref.revision, art);
  while (PROGRAMS.size > PROGRAMS_MAX) PROGRAMS.delete(PROGRAMS.keys().next().value!);
  return art;
}

function run(job: JobMessage): readonly Decided[] {
  for (const [hash, text] of job.parts) if (!PARTS.has(hash)) PARTS.set(hash, parsePart(text));
  let cases = CASES.get(job.caseSet);
  if (!cases) {
    CASES.set(job.caseSet, (cases = []));
    // first in, first out, as the pool forgets them (CASE_SETS_MAX there)
    while (CASES.size > CASE_SETS_MAX) {
      const old = CASES.keys().next().value!;
      CASES.delete(old);
      for (const k of [...OUTCOMES.keys()]) if (k.startsWith(`${old}:`)) OUTCOMES.delete(k);
    }
  }
  for (const [i, c] of job.cases) cases[i] = c;
  const okey = `${job.caseSet}:${job.origin.revision}:${job.paramsKey}`;
  let outcomes = OUTCOMES.get(okey);
  if (!outcomes) OUTCOMES.set(okey, (outcomes = []));
  const spec = differentialSpec(meaningKept(job.params));
  const inputs = { origin: program(job.origin), candidate: program(job.candidate) } as never;
  return job.todo.map(i => {
    const c = cases![i];
    if (!c) throw new Error(`meaning worker: no case ${i} of case set ${job.caseSet}`);
    return decideCase(spec, inputs, c, i, outcomes);
  });
}

parentPort!.on('message', (job: JobMessage) => {
  const t0 = performance.now();
  try {
    const verdicts = run(job);
    parentPort!.postMessage({ id: job.id, verdicts, ms: performance.now() - t0 } satisfies ReplyMessage);
  } catch (e) {
    parentPort!.postMessage({ id: job.id, error: (e as Error)?.stack ?? String(e) } satisfies ReplyMessage);
  }
});
