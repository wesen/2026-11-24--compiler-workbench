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
import { immutable } from '../../framework/core/data.js';
import { meaningKept, type Case } from '../evaluate.js';
import type { BlockRec, FnRec, OpRec, StmtRec, TypedBlocks, ValueRec } from '../model.js';
import { CASE_SETS_MAX, type JobMessage, type ProgramRef, type ReplyMessage } from './protocol.js';

type PartRecords = readonly [
  FnRec & { readonly blocks: readonly string[] },
  readonly BlockRec[],
  readonly StmtRec[],
  readonly ValueRec[],
  readonly OpRec[],
];
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
  const fns: Record<string, unknown> = {},
    blocks: Record<string, BlockRec> = {},
    stmts: Record<string, StmtRec> = {},
    values: Record<string, ValueRec> = {},
    ops: Record<string, OpRec> = {};
  ref.fnOrder.forEach((name, i) => {
    const p = PARTS.get(ref.hashes[i]);
    if (!p) throw new Error(`meaning worker: no part ${ref.hashes[i]} for ${name}`);
    fns[name] = p[0];
    for (const b of p[1]) blocks[b.id] = b;
    for (const s of p[2]) stmts[s.id] = s;
    for (const x of p[3]) values[x.id] = x;
    for (const o of p[4]) ops[o.id] = o;
  });
  // the records are canonical already, so this builds only the tables; the evaluator reads records by id and
  // functions by name, which is all a program assembled from its parts has to agree on with the original
  const value = immutable({
    formatVersion: 1,
    program: ref.program,
    rev: ref.rev,
    counters: {},
    fnOrder: ref.fnOrder,
    fns,
    blocks,
    stmts,
    values,
    ops,
    frontEnd: {},
  }) as unknown as TypedBlocks;
  art = { value };
  PROGRAMS.set(ref.revision, art);
  while (PROGRAMS.size > PROGRAMS_MAX) PROGRAMS.delete(PROGRAMS.keys().next().value!);
  return art;
}

function run(job: JobMessage): readonly Decided[] {
  for (const [hash, text] of job.parts) if (!PARTS.has(hash)) PARTS.set(hash, immutable(JSON.parse(text)));
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
