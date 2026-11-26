/**
 * IRWB-004 F4: a pool of Node worker threads for independent runs (a corpus project's pipeline, a scene's
 * specialization, a strategy's candidate): each worker imports one module and calls one of its exports per job.
 *
 *   const pool = startJobPool(new URL('./job.mjs', import.meta.url), 'run', { threads: 4 });
 *   const outputs = await Promise.all(inputs.map(x => pool.run(x)));
 *   await pool.close();
 *
 * Inputs and outputs are structured-cloned. A job goes to the first idle worker, so jobs of uneven cost balance;
 * the results come back in the order of the calls whatever order they finish in. Node only.
 */
import { Worker } from 'node:worker_threads';

export interface JobPool<I, O> {
  readonly threads: number;
  run(input: I): Promise<O>;
  close(): Promise<void>;
}

const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const ready = import(workerData.module).then(m => {
  const f = m[workerData.name];
  if (typeof f !== 'function') throw new Error(workerData.module + ' has no export ' + workerData.name);
  return f;
});
parentPort.on('message', async ({ id, input }) => {
  try {
    const f = await ready;
    parentPort.postMessage({ id, output: await f(input) });
  } catch (e) {
    parentPort.postMessage({ id, error: (e && e.stack) || String(e) });
  }
});
`;

export function startJobPool<I, O>(
  module: URL | string,
  name: string,
  options: { threads?: number; maxOldSpaceMB?: number } = {},
): JobPool<I, O> {
  const threads = Math.max(1, options.threads ?? 4);
  const href = typeof module === 'string' ? module : module.href;
  type Slot = { worker: Worker; busy: boolean };
  const queue: { id: number; input: I }[] = [];
  const waiting = new Map<number, { resolve: (o: O) => void; reject: (e: Error) => void; slot?: Slot }>();
  let next = 1;
  const slots: Slot[] = Array.from({ length: threads }, () => {
    const worker = new Worker(WORKER, {
      eval: true,
      workerData: { module: href, name },
      ...(options.maxOldSpaceMB ? { resourceLimits: { maxOldGenerationSizeMb: options.maxOldSpaceMB } } : {}),
    });
    const slot: Slot = { worker, busy: false };
    worker.on('message', (m: { id: number; output?: O; error?: string }) => {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      slot.busy = false;
      if (w) m.error !== undefined ? w.reject(new Error(m.error)) : w.resolve(m.output as O);
      pump();
    });
    worker.on('error', e => {
      for (const [id, w] of waiting)
        if (w.slot === slot) {
          waiting.delete(id);
          w.reject(e);
        }
    });
    worker.unref();
    return slot;
  });
  function pump(): void {
    for (const slot of slots) {
      if (!queue.length) break;
      if (slot.busy) continue;
      const job = queue.shift()!;
      slot.busy = true;
      waiting.get(job.id)!.slot = slot;
      slot.worker.ref();
      slot.worker.postMessage(job);
    }
    for (const slot of slots) if (!slot.busy) slot.worker.unref();
  }
  return {
    threads,
    run(input: I): Promise<O> {
      const id = next++;
      const p = new Promise<O>((resolve, reject) => waiting.set(id, { resolve, reject }));
      queue.push({ id, input });
      pump();
      return p;
    },
    async close() {
      await Promise.all(slots.map(s => s.worker.terminate()));
    },
  };
}
