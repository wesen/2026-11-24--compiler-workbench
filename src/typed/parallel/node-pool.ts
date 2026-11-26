/**
 * IRWB-004 F4: a pool of Node worker threads that decides the cases of `typed.meaning-kept`.
 *
 *   const pool = startMeaningPool({ threads: 4 });
 *   setMeaningExecutor(pool);            // every meaning check now hands its undecided cases to the pool
 *   …
 *   setMeaningExecutor(undefined); await pool.close();
 *
 * Case i of a case set always goes to worker i mod N, so a worker computes the origin's outcome of each of its cases
 * once and keeps it. Programs travel as function parts: a job lists each program's part hashes and carries only the
 * parts the worker does not have yet, so after the first check a job carries the functions the pass changed. The
 * verdicts come back per worker and are put back in the order of the job's indices.
 *
 * Node only (node:worker_threads); nothing else imports this module.
 */
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import type { Decided } from '../../framework/contracts/differential.js';
import type { Artifact } from '../../framework/core/types.js';
import type { Case } from '../evaluate.js';
import type { MeaningExecutor, MeaningJob } from '../meaning-exec.js';
import type { TypedBlocks } from '../model.js';
import { partHash, partsOf, partText, type FunctionPart } from '../parts.js';
import { CASE_SETS_MAX, type JobMessage, type ProgramRef, type ReplyMessage } from './protocol.js';

export interface MeaningPoolOptions {
  /** Worker threads (default: 4, or fewer on a machine with fewer cores). */
  readonly threads?: number;
  /** Jobs with fewer undecided cases than this are decided on the calling thread (default 64). */
  readonly minCases?: number;
}
export interface MeaningPoolStats {
  jobs: number;
  local: number;
  cases: number;
  partsSent: number;
  casesSent: number;
  /** Per worker, the time spent deciding (ms). */
  busyMs: number[];
}
export interface MeaningPool extends MeaningExecutor {
  readonly threads: number;
  readonly stats: MeaningPoolStats;
  close(): Promise<void>;
}

interface Slot {
  readonly worker: Worker;
  readonly parts: Set<string>;
  /** Per case set, the indices this worker has. */
  readonly cases: Map<number, Set<number>>;
  pending: number;
}

const refOf = (a: Artifact<TypedBlocks>): ProgramRef => {
  const parts = partsOf(a.value);
  return {
    revision: a.revision,
    program: a.value.program,
    rev: a.value.rev,
    fnOrder: a.value.fnOrder,
    hashes: a.value.fnOrder.map(n => partHash(parts.get(n)!)),
  };
};

const sortedJson = (x: unknown): string =>
  JSON.stringify(x, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

export function startMeaningPool(options: MeaningPoolOptions = {}): MeaningPool {
  const threads = Math.max(1, Math.min(options.threads ?? 4, Math.max(1, availableParallelism())));
  const minCases = options.minCases ?? 64;
  const stats: MeaningPoolStats = { jobs: 0, local: 0, cases: 0, partsSent: 0, casesSent: 0, busyMs: [] };
  const waiting = new Map<
    number,
    { resolve: (v: readonly Decided[]) => void; reject: (e: Error) => void; slot: Slot }
  >();
  let nextId = 1,
    closed = false;
  const caseSets = new WeakMap<readonly Case[], number>();
  const caseSetOrder: number[] = [];
  let nextCaseSet = 1;
  const slots: Slot[] = Array.from({ length: threads }, (_, w) => {
    const worker = new Worker(new URL('./meaning-worker.js', import.meta.url));
    const slot: Slot = { worker, parts: new Set(), cases: new Map(), pending: 0 };
    stats.busyMs[w] = 0;
    worker.on('message', (m: ReplyMessage) => {
      const wait = waiting.get(m.id);
      if (!wait) return;
      waiting.delete(m.id);
      if (--slot.pending === 0) worker.unref();
      if ('error' in m) wait.reject(new Error(`meaning worker ${w}: ${m.error}`));
      else {
        stats.busyMs[w] += m.ms;
        wait.resolve(m.verdicts);
      }
    });
    worker.on('error', e => {
      for (const [id, wait] of waiting)
        if (wait.slot === slot) {
          waiting.delete(id);
          wait.reject(e);
        }
    });
    worker.unref();
    return slot;
  });
  const caseSetOf = (cases: readonly Case[]): number => {
    let id = caseSets.get(cases);
    if (id === undefined) {
      caseSets.set(cases, (id = nextCaseSet++));
      caseSetOrder.push(id);
      // the workers forget the oldest case set past CASE_SETS_MAX; so does the pool
      while (caseSetOrder.length > CASE_SETS_MAX) {
        const old = caseSetOrder.shift()!;
        for (const s of slots) s.cases.delete(old);
      }
    }
    return id;
  };
  const send = (slot: Slot, job: JobMessage): Promise<readonly Decided[]> =>
    new Promise((resolve, reject) => {
      waiting.set(job.id, { resolve, reject, slot });
      if (slot.pending++ === 0) slot.worker.ref();
      slot.worker.postMessage(job);
    });

  return {
    threads,
    stats,
    decide(job: MeaningJob): Promise<readonly Decided[]> | undefined {
      if (closed || job.todo.length < minCases) {
        stats.local++;
        return undefined;
      }
      stats.jobs++;
      stats.cases += job.todo.length;
      const origin = refOf(job.origin),
        candidate = refOf(job.candidate);
      const byHash = new Map<string, FunctionPart>();
      for (const parts of [partsOf(job.origin.value), partsOf(job.candidate.value)])
        for (const p of parts.values()) byHash.set(partHash(p), p);
      const textOf = (hash: string): string => partText(byHash.get(hash)!);
      const caseSet = caseSetOf(job.cases);
      const paramsKey = sortedJson(job.params);
      const byWorker: number[][] = slots.map(() => []);
      for (const i of job.todo) byWorker[i % threads].push(i);
      const sends = slots.map((slot, w) => {
        const todo = byWorker[w];
        if (!todo.length) return Promise.resolve([] as readonly Decided[]);
        const parts: [string, string][] = [];
        for (const h of new Set([...origin.hashes, ...candidate.hashes]))
          if (!slot.parts.has(h)) {
            parts.push([h, textOf(h)]);
            slot.parts.add(h);
          }
        let have = slot.cases.get(caseSet);
        if (!have) slot.cases.set(caseSet, (have = new Set()));
        const cases: [number, Case][] = [];
        for (const i of todo)
          if (!have.has(i)) {
            cases.push([i, job.cases[i]]);
            have.add(i);
          }
        stats.partsSent += parts.length;
        stats.casesSent += cases.length;
        return send(slot, {
          type: 'job',
          id: nextId++,
          params: job.params,
          paramsKey,
          caseSet,
          origin,
          candidate,
          parts,
          cases,
          todo,
        });
      });
      return Promise.all(sends).then(results => {
        const at = slots.map(() => 0);
        return job.todo.map(i => {
          const w = i % threads;
          return results[w][at[w]++];
        });
      });
    },
    async close() {
      closed = true;
      await Promise.all(slots.map(s => s.worker.terminate()));
    },
  };
}
