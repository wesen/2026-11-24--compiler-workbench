/**
 * Compilation strategies: v6 Strategy IR plans over the typed passes, run per program from inside the workbench.
 *
 * A strategy is data (a serializable StrategyPlan), so a project can carry its own in `strategies/<name>.json`
 * and the workbench can list, show, edit and run them. Every pass inside a plan is the framework pass, gated by
 * the meaning contract against r0 under the program's assumptions; a pass whose output is rejected makes its
 * branch a rejected candidate. `chooseBest` over a `fork` compares finished candidates by `typed.metrics@1`
 * (statement count, image bytes, emulator instructions over seeded cases) and records every alternative with its
 * metrics or its rejection. `runStrategy` publishes only the winning chain into the program's revision timeline,
 * one revision per pass, with each pass's edits and correspondence intact, so `why` works as for any pipeline.
 */
import type { Artifact } from '../framework/core/types.js';
import { passAlgorithm } from '../framework/passes/bridge.js';
import type { PassResult } from '../framework/passes/define-pass.js';
import {
  algorithm,
  apply,
  chooseBest,
  fork,
  plan,
  repeatUntilStable,
  sequence,
} from '../framework/strategy/builders.js';
import { execute } from '../framework/strategy/interpreter.js';
import type {
  NodeExecution,
  StrategyAlgorithm,
  StrategyNode,
  StrategyPlan,
  TraceEvent,
} from '../framework/strategy/ir.js';
import { AlgorithmRegistry } from '../framework/strategy/registry.js';
import { deserialize, serialize } from '../framework/strategy/serialization.js';
import { lowerToImage, runImage } from './backend/index.js';
import { USER_PASSES } from './builder.js';
import { casesFrom } from './evaluate.js';
import { storeOf } from './ir.js';
import type { TypedBlocks } from './model.js';
import { optimizationContract, PASSES, PIPELINES, type RevisionReport, type TypedPass } from './passes.js';
import type { Program } from './program.js';

export interface MetricsOptions {
  /** Cases per function for the instruction count (seeded like the checks). */
  readonly count?: number;
  readonly seed?: number;
  /** Awaited before each algorithm runs: a host (a web page) can yield to its event loop between passes. */
  readonly pause?: () => Promise<void>;
  /** The interpreter's trace events as they happen (progress). */
  readonly onEvent?: (event: TraceEvent) => void;
}

/** The metrics a candidate program is judged by. */
export function measure(
  p: Program,
  art: Artifact<TypedBlocks>,
  opts: MetricsOptions = {},
): Record<string, number> {
  const st = storeOf(art.value);
  let statements = 0,
    blocks = 0;
  for (const f of st.fns.values()) {
    blocks += f.blocks.length;
    for (const b of f.blocks) statements += b.stmts.length;
  }
  const { image } = lowerToImage(art);
  let instructions = 0;
  for (const fn of art.value.fnOrder)
    for (const c of casesFrom(st, fn, {
      count: opts.count ?? 10,
      seed: opts.seed ?? 7,
      inputs: p.inputs[fn] ?? {},
    }))
      instructions += runImage(image, fn, c.args, c.memory, { limit: 2e5 }).steps;
  return { statements, blocks, bytes: image.value.bytes, instructions };
}

/** Algorithms a strategy may name: every built-in and user pass, the identity, and the metrics. */
export function strategyRegistry(
  p: Program,
  opts: MetricsOptions & { onResult?: (r: PassResult<TypedBlocks>) => void } = {},
): AlgorithmRegistry {
  const registry = new AlgorithmRegistry();
  const pause = opts.pause;
  const register = (a: StrategyAlgorithm) =>
    registry.register(
      pause
        ? {
            id: a.id,
            version: a.version,
            kind: a.kind,
            description: a.description,
            run: async (c, input, args) => {
              await pause();
              return a.run(c, input, args);
            },
          }
        : a,
    );
  const contract = optimizationContract({ inputs: p.inputs, count: 40, seed: 7 });
  const passes: TypedPass[] = [...Object.values(PASSES), ...USER_PASSES.values()];
  for (const pass of passes)
    register(
      passAlgorithm(pass, {
        manager: p.manager,
        contract,
        contractInputs: () => ({ origin: p.origin }),
        onResult: opts.onResult as never,
      }),
    );
  register({
    id: 'typed.keep',
    version: '1',
    kind: 'transform',
    description: 'the program as it is',
    run: (_c, input) => input,
  });
  register({
    id: 'typed.metrics',
    version: '1',
    kind: 'metrics',
    description: 'statements, blocks, image bytes, and emulator instructions over seeded cases',
    run: (_c, input) => measure(p, input as Artifact<TypedBlocks>, opts),
  });
  return registry;
}

// ---------- plan shapes ----------
const passNode = (prefix: string, name: string, i: number) =>
  apply(`${prefix}/${i}:${name}`, algorithm(`typed.${name}`, '1'));

/** A sequence of passes (a pipeline by name or a list of pass names). */
export function passesNode(id: string, passes: string | readonly string[]): StrategyNode {
  const names = typeof passes === 'string' ? PIPELINES[passes] : passes;
  if (!names) throw new Error(`unknownPipeline: no pipeline "${passes}"`);
  return names.length
    ? sequence(id, ...names.map((n, i) => passNode(id, n, i)))
    : apply(`${id}/keep`, algorithm('typed.keep', '1'));
}

/** Run each named candidate on the program and keep the best by `metric` (subject to constraints). */
export function choosePlan(
  name: string,
  candidates: Readonly<Record<string, string | readonly string[]>>,
  objective: { metric: 'statements' | 'blocks' | 'bytes' | 'instructions'; direction?: 'min' | 'max' },
  constraints: readonly { metric: string; op: '<=' | '>=' | '<' | '>' | '=='; value: number }[] = [],
): StrategyPlan {
  const branches = Object.entries(candidates).map(([n, passes]) => ({
    name: n,
    strategy: passesNode(`${name}/${n}`, passes),
  }));
  return plan(
    `typed.strategy.${name}`,
    chooseBest(
      `${name}/choose`,
      fork(`${name}/candidates`, branches),
      { metric: objective.metric, direction: objective.direction ?? 'min' },
      {
        metrics: algorithm('typed.metrics', '1'),
        constraints,
      },
    ),
  );
}

/** Repeat a group of passes until the program stops changing. */
export function untilStablePlan(name: string, passes: readonly string[], maxIterations = 8): StrategyPlan {
  return plan(
    `typed.strategy.${name}`,
    repeatUntilStable(`${name}/loop`, passesNode(`${name}/body`, passes), { maxIterations }),
  );
}

export const toJson = (p: StrategyPlan) => serialize(p);
export const fromJson = (text: string, registry?: AlgorithmRegistry) => deserialize(text, registry);

// ---------- running ----------
export interface StrategyRun {
  readonly status: string;
  readonly rev: string;
  /** The passes of the winning chain, in order, as published revisions. */
  readonly published: readonly string[];
  /** Every chooseBest decision: winner and alternatives with metrics or rejection reasons. */
  readonly decisions: readonly unknown[];
  readonly error?: { code: string; message: string };
  readonly execution: { id: string; nodes: number; ms: number };
  /** One row per node the interpreter ran, in order (no artifacts: their revisions only). */
  readonly trace?: readonly StrategyTraceRow[];
}

export interface StrategyTraceRow {
  readonly nodeId: string;
  readonly kind: string;
  readonly path: string;
  readonly parent?: string;
  readonly status: string;
  readonly ms?: number;
  readonly branch?: string;
  readonly iteration?: number;
  /** The revision (content hash) of the node's output artifact, when it produced one. */
  readonly output?: string;
  readonly evidence: readonly string[];
  readonly error?: { readonly code: string; readonly message: string };
}

const revisionOf = (x: unknown) =>
  x && typeof x === 'object' && typeof (x as { revision?: unknown }).revision === 'string'
    ? (x as { revision: string }).revision
    : undefined;

/** The execution's node records as plain rows. */
export function traceRows(records: readonly NodeExecution[]): StrategyTraceRow[] {
  const byId = new Map(records.map(r => [r.id, r.nodeId]));
  return records.map(r => ({
    nodeId: r.nodeId,
    kind: r.kind,
    path: r.path,
    ...(r.parentId ? { parent: byId.get(r.parentId) } : {}),
    status: r.status,
    ...(r.durationMs !== undefined ? { ms: +r.durationMs.toFixed(1) } : {}),
    ...(r.branch !== undefined ? { branch: r.branch } : {}),
    ...(r.iteration !== undefined ? { iteration: r.iteration } : {}),
    ...(revisionOf(r.output) ? { output: revisionOf(r.output) } : {}),
    evidence: r.evidence.map(e => e.label),
    ...(r.error ? { error: { code: r.error.code, message: r.error.message } } : {}),
  }));
}

export async function runStrategy(
  p: Program,
  strategy: StrategyPlan,
  opts: MetricsOptions = {},
): Promise<StrategyRun> {
  const results = new Map<string, PassResult<TypedBlocks>>();
  const registry = strategyRegistry(p, {
    ...opts,
    onResult: r => r.changed && results.set(r.artifact.revision, r),
  });
  const exec = await execute(strategy, registry, p.head, opts.onEvent ? { onEvent: opts.onEvent } : {});
  const decisions = exec.records.flatMap(r =>
    r.evidence.filter(e => e.label === 'selection').map(e => e.data),
  );
  const summary = {
    id: exec.id,
    nodes: exec.records.length,
    ms: +(exec.endedAt - exec.startedAt).toFixed(1),
  };
  if (exec.status !== 'succeeded')
    return {
      status: exec.status,
      rev: `r${p.rev}`,
      published: [],
      decisions,
      error: exec.error,
      execution: summary,
      trace: traceRows(exec.records),
    };
  // walk back from the winner to the head through the pass results, then publish them in order
  const chain: PassResult<TypedBlocks>[] = [];
  for (let cur = exec.value as Artifact<TypedBlocks>; cur.revision !== p.head.revision; ) {
    const r = results.get(cur.revision);
    if (!r)
      throw new Error(`strategy result ${cur.revision} is not reachable from the head through pass results`);
    chain.unshift(r);
    cur = r.before;
  }
  for (const r of chain) {
    const report = r.report as RevisionReport;
    p.revisions.push({
      rev: p.rev + 1,
      pass: report.pass,
      artifact: r.artifact,
      edits: report.edits,
      correspondence: r.correspondence,
      ms: 0,
      fns: report.fns,
      assumptions: JSON.parse(JSON.stringify(p.assumptions)),
      note: `strategy ${strategy.id}`,
    });
  }
  return {
    status: exec.status,
    rev: `r${p.rev}`,
    published: chain.map(r => (r.report as RevisionReport).pass),
    decisions,
    execution: summary,
    trace: traceRows(exec.records),
  };
}

/** A project's own strategies: `strategies/<name>.json` files holding serialized plans. */
export function projectStrategies(files: Readonly<Record<string, string>>): Record<string, StrategyPlan> {
  const out: Record<string, StrategyPlan> = {};
  for (const [path, text] of Object.entries(files)) {
    const m = /^strategies\/([^/]+)\.json$/.exec(path);
    if (m) out[m[1]] = deserialize(text);
  }
  return out;
}
