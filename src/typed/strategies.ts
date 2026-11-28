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
  identityAlgorithm,
  literal,
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
import { deserialize } from '../framework/strategy/serialization.js';
import { assertValid } from '../framework/strategy/validation.js';
import { formatJson, joinText, TILE_WIDTH } from './format.js';
import { lowerToImage, runImage } from './backend/index.js';
import { USER_PASSES } from './builder.js';
import { casesFrom } from './evaluate.js';
import { storeOf } from './ir.js';
import type { TypedBlocks } from './model.js';
import {
  optimizationContract,
  PASSES,
  PIPELINES,
  typedPass,
  type RevisionReport,
  type TypedPass,
} from './passes.js';
import type { Program } from './program.js';

export interface MetricsOptions {
  /** Cases per function for the instruction count (seeded like the checks). */
  readonly count?: number;
  readonly seed?: number;
  /** Measure only this function's cases (instructions include the callees it runs). */
  readonly fn?: string;
  /** Awaited before each algorithm runs: a host (a web page) can yield to its event loop between passes. */
  readonly pause?: () => Promise<void>;
  /** The interpreter's trace events as they happen (progress). */
  readonly onEvent?: (event: TraceEvent) => void;
}

const LIMIT = 2e5;
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
  let instructions = 0,
    limited = 0;
  for (const fn of opts.fn ? [opts.fn] : art.value.fnOrder)
    for (const c of casesFrom(st, fn, {
      count: opts.count ?? 10,
      seed: opts.seed ?? 7,
      inputs: p.inputs[fn] ?? {},
    })) {
      // a run that hits the step limit costs the limit (its own step count is unknown); `limited` counts them
      const r = runImage(image, fn, c.args, c.memory, { limit: LIMIT });
      if (r.limit || !Number.isFinite(r.steps)) {
        instructions += LIMIT;
        limited++;
      } else instructions += r.steps;
    }
  return { statements, blocks, bytes: image.value.bytes, instructions, limited };
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
  // each pass also restricted to one function, as `typed.<pass>@<fn>` (the per-function search applies these)
  const scoped: TypedPass[] = passes
    .filter(pass => !pass.typed.program)
    .flatMap(pass =>
      p.fns().map(fn =>
        typedPass({
          ...pass.typed,
          name: `${pass.typed.name}@${fn}`,
          about: `${pass.typed.about} (only in ${fn})`,
          body: ctx => (ctx.f.name === fn ? pass.typed.body(ctx) : undefined),
        }),
      ),
    );
  for (const pass of [...passes, ...scoped])
    register(
      passAlgorithm(pass, {
        manager: p.manager,
        contract,
        contractInputs: () => ({ origin: p.origin }),
        onResult: opts.onResult as never,
      }),
    );
  register(identityAlgorithm);
  register({
    id: 'typed.metrics',
    version: '1',
    kind: 'metrics',
    description: 'statements, blocks, image bytes, and emulator instructions over seeded cases',
    run: (_c, input, args) =>
      measure(p, input as Artifact<TypedBlocks>, { ...opts, ...((args as MetricsOptions | null) ?? {}) }),
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
    : apply(`${id}/keep`, algorithm(identityAlgorithm.id, identityAlgorithm.version));
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
    strategy: passesNode(n, passes),
  }));
  return plan(
    `typed.strategy.${name}`,
    chooseBest(
      'choose',
      fork('candidates', branches),
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
    repeatUntilStable('repeat', passesNode('body', passes), { maxIterations }),
  );
}

/** A plan as JSON for a tile: valid, canonical key order, at most `width` columns where the content allows. */
export const toJson = (p: StrategyPlan, width = TILE_WIDTH) => {
  assertValid(p);
  return formatJson(p, width);
};
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

/**
 * Search per function: for each function in source order, run every candidate pass list restricted to that
 * function and keep the one that minimizes (or maximizes) the metric on that function's own cases. The choices
 * chain, so later functions are optimized after earlier ones; every candidate is checked against r0.
 */
export function searchPlan(
  name: string,
  fns: readonly string[],
  candidates: Readonly<Record<string, string | readonly string[]>>,
  objective: { metric: 'statements' | 'blocks' | 'bytes' | 'instructions'; direction?: 'min' | 'max' } = {
    metric: 'instructions',
  },
): StrategyPlan {
  const steps = fns.map(fn => {
    const branches = Object.entries(candidates).map(([n, passes]) => {
      const names = typeof passes === 'string' ? PIPELINES[passes] : passes;
      if (!names) throw new Error(`unknownPipeline: no pipeline "${passes}"`);
      return {
        name: n,
        strategy: names.length
          ? sequence(
              `${fn}:${n}`,
              ...names.map((x, i) => apply(`${fn}:${n}/${i}:${x}`, algorithm(`typed.${x}@${fn}`, '1'))),
            )
          : apply(`${fn}:${n}/keep`, algorithm(identityAlgorithm.id, identityAlgorithm.version)),
      };
    });
    return chooseBest(
      `choose:${fn}`,
      fork(`candidates:${fn}`, branches),
      { metric: objective.metric, direction: objective.direction ?? 'min' },
      { metrics: algorithm('typed.metrics', '1'), args: literal({ fn }) },
    );
  });
  return plan(`typed.strategy.${name}`, steps.length === 1 ? steps[0] : sequence('functions', ...steps));
}

// ---------- the short form ----------
/**
 * The form strategies are written in (a preset, a project's `strategies/<name>.json`); it compiles to a plan.
 * Exactly one of `passes`, `choose` or `repeat`:
 *   { "passes": "O2" }                                   a pipeline, or a list of pass names
 *   { "choose": { "O1": "O1", "O2": "O2" }, "by": "instructions", "constraints": [["bytes", "<=", 100]] }
 *   { "repeat": ["cfg", "fold", "dce"], "max": 8 }       until the program stops changing
 * `about` (a string, or lines joined with spaces) says what it is for.
 */
export interface StrategySpec {
  readonly about?: string | readonly string[];
  readonly passes?: string | readonly string[];
  readonly choose?: Readonly<Record<string, string | readonly string[]>>;
  readonly by?: 'statements' | 'blocks' | 'bytes' | 'instructions';
  readonly direction?: 'min' | 'max';
  readonly constraints?: readonly (readonly [string, '<=' | '>=' | '<' | '>' | '==', number])[];
  readonly repeat?: readonly string[];
  readonly max?: number;
}

export function planFromSpec(name: string, spec: StrategySpec): StrategyPlan {
  const forms = [spec.passes !== undefined, spec.choose !== undefined, spec.repeat !== undefined].filter(
    Boolean,
  );
  if (forms.length !== 1) throw new Error(`strategy ${name}: give exactly one of passes, choose or repeat`);
  if (spec.choose)
    return choosePlan(
      name,
      spec.choose,
      { metric: spec.by ?? 'instructions', direction: spec.direction ?? 'min' },
      (spec.constraints ?? []).map(([metric, op, value]) => ({ metric, op, value })),
    );
  if (spec.repeat) return untilStablePlan(name, spec.repeat, spec.max ?? 8);
  return plan(`typed.strategy.${name}`, passesNode(name, spec.passes!));
}

/** The workbench's built-in strategies, in the short form. */
export const PRESETS: Readonly<Record<string, StrategySpec>> = Object.freeze({
  O2: { about: "Compiler Workbench's O2 pipeline, as one plan", passes: 'O2' },
  fastest: {
    about: ['The standard pipeline that runs the fewest instructions', "on the project's own cases."],
    choose: { O0: 'O0', O1: 'O1', O2: 'O2', loops: 'loops' },
    by: 'instructions',
  },
  smallest: {
    about: 'The standard pipeline with the smallest image.',
    choose: { O0: 'O0', O1: 'O1', O2: 'O2', loops: 'loops' },
    by: 'bytes',
  },
  cleanup: {
    about: ['Constant folding, propagation and dead code,', 'repeated until nothing changes.'],
    repeat: ['cfg', 'fold', 'simplify', 'constprop', 'dce'],
  },
  // IRWB-003
  speed: {
    about: [
      'Two levels of inlining, O2+, loop rotation, as one plan.',
      'Meant for the options chains, coalesce, homes.',
    ],
    passes: 'speed',
  },
  'fastest-all': {
    about: ['The pipeline that runs the fewest instructions,', 'O2+ and speed included.'],
    choose: { O0: 'O0', O1: 'O1', O2: 'O2', loops: 'loops', 'O2+': 'O2+', speed: 'speed' },
    by: 'instructions',
  },
});

/** The presets as the files the workbench shows (`strategies/<name>.json`, at tile width). */
export function presetFiles(width = TILE_WIDTH): Record<string, string> {
  return Object.fromEntries(
    Object.entries(PRESETS).map(([n, spec]) => [`strategies/${n}.json`, formatJson(spec, width)]),
  );
}

export const aboutOf = (spec: StrategySpec) => joinText(spec.about);

/** A project's own strategies: `strategies/<name>.json` files, in the short form or as serialized plans. */
export function projectStrategies(files: Readonly<Record<string, string>>): Record<string, StrategyPlan> {
  const out: Record<string, StrategyPlan> = {};
  for (const [path, text] of Object.entries(files)) {
    const m = /^strategies\/([^/]+)\.json$/.exec(path);
    if (!m) continue;
    const value = JSON.parse(text);
    // a full plan (formatVersion), or the short form
    out[m[1]] = value && value.formatVersion !== undefined ? deserialize(text) : planFromSpec(m[1], value);
  }
  return out;
}
