/**
 * IRWB-001 E4: dataflow problems as v6 analyses.
 *
 * `dataflow()` turns a lattice, a transfer function and a description of the flow regions of an IR into a v6
 * `AnalysisDefinition`. The analysis manager then caches the solved facts per exact artifact revision, like any
 * other analysis.
 *
 * Checked transfer (Compiler Workbench's `preserves`, made checkable): the definition declares which entity and
 * relation kinds its result is a function of (`reads`). Its transfer verifier diffs the two revisions through the
 * adapter and accepts the transfer only when no entity or relation of a read kind changed. A pass that claims to
 * preserve a fact therefore cannot keep a stale one: the claim is checked against the actual change set.
 */
import type { Artifact, Json } from '../core/types.js';
import { immutable } from '../core/data.js';
import { defineAnalysis, defineType } from '../contracts/definitions.js';
import type { AnalysisDefinition, CheckResult, IRType } from '../contracts/types.js';
import { openIR } from '../ir/view.js';
import { diff } from '../ir/diff.js';
import type { ChangeSet, IRAdapter, IRView } from '../ir/types.js';
import type { Lattice } from './lattices.js';
import { solve, type FlowGraph, type Solution } from './solver.js';

/** One independently solved region of an IR, usually a function. */
export interface FlowRegion {
  readonly id: string;
  readonly graph: FlowGraph;
}

/** Kinds the analysis reads. A trailing `*` matches a prefix (`stmt.*`). */
export interface ReadSet {
  readonly entities: readonly string[];
  readonly relations: readonly string[];
}

export interface DataflowSpec<S, V, C = unknown> {
  readonly id: string;
  readonly version: string;
  readonly description: string;
  readonly input: IRType<S>;
  readonly adapter: IRAdapter<S>;
  readonly direction: 'forward' | 'backward';
  readonly lattice: Lattice<V>;
  /** Flow regions of one revision, and per-region context handed to transfer (e.g. the function's locals). */
  regions(view: IRView<S>, params: unknown): readonly (FlowRegion & { readonly context: C })[];
  transfer(block: string, input: V, context: C, region: FlowRegion): V;
  boundary?(region: FlowRegion, context: C): V;
  widen?(previous: V, next: V, block: string, context: C, region: FlowRegion): V;
  readonly widenAfter?: number;
  edge?(from: string, to: string, value: V, context: C, region: FlowRegion): V;
  readonly strategy?: 'worklist' | 'round-robin';
  readonly reads: ReadSet;
  readonly maxIterations?: number;
}

/** The persisted result: per region, the encoded in/out facts of every block. */
export interface DataflowResult {
  readonly analysis: string;
  readonly direction: 'forward' | 'backward';
  readonly regions: Readonly<
    Record<
      string,
      {
        readonly in: Readonly<Record<string, Json>>;
        readonly out: Readonly<Record<string, Json>>;
        readonly iterations: number;
        readonly rounds: number;
        readonly loopHeads: readonly string[];
      }
    >
  >;
}

const finiteJson = (value: unknown, path = '$'): void => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Dataflow result ${path} is not finite`);
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => finiteJson(v, `${path}[${i}]`));
  if (typeof value === 'object')
    return Object.entries(value).forEach(([k, v]) => finiteJson(v, `${path}.${k}`));
  throw new Error(`Dataflow result ${path} is not JSON`);
};

const matches = (patterns: readonly string[], kind: string) =>
  patterns.some(p => (p.endsWith('*') ? kind.startsWith(p.slice(0, -1)) : p === kind));

/** The changes in `changes` that touch what an analysis reads. */
export function readsTouched(reads: ReadSet, changes: ChangeSet): readonly string[] {
  const touched = new Set<string>();
  for (const c of changes.entities) {
    for (const e of [c.before, c.after])
      if (e && matches(reads.entities, e.kind)) touched.add(`entity ${c.entity} (${e.kind})`);
  }
  for (const c of changes.relations) {
    for (const r of [c.before, c.after])
      if (r && matches(reads.relations, r.kind)) touched.add(`relation ${c.relation} (${r.kind})`);
  }
  return [...touched].sort();
}

export type DataflowAnalysis<S, V> = AnalysisDefinition<S, DataflowResult> & {
  readonly spec: DataflowSpec<S, V, any>;
  /** Decode one region's solved facts back into lattice values. */
  decode(result: DataflowResult, region: string): Solution<V>;
  /** Solve directly, without the analysis manager (tools, tests). */
  solveArtifact(subject: Artifact<S>, params?: unknown): DataflowResult;
};

export function dataflow<S, V, C = unknown>(spec: DataflowSpec<S, V, C>): DataflowAnalysis<S, V> {
  const output = defineType<DataflowResult>({
    id: `${spec.id}.result`,
    version: spec.version,
    description: `Solved ${spec.direction} ${spec.lattice.name} facts of ${spec.id}`,
    validate(value: unknown): asserts value is DataflowResult {
      finiteJson(value);
      const v = value as DataflowResult;
      if (!v || v.analysis !== spec.id || typeof v.regions !== 'object')
        throw new Error(`Not a ${spec.id} result`);
    },
  });
  const solveArtifact = (subject: Artifact<S>, params: unknown = null): DataflowResult => {
    const view = openIR(subject, spec.adapter);
    const regions: Record<string, DataflowResult['regions'][string]> = {};
    for (const region of spec.regions(view, params)) {
      const solution = solve(region.graph, {
        direction: spec.direction,
        lattice: spec.lattice,
        boundary: spec.boundary?.(region, region.context),
        transfer: (b, v) => spec.transfer(b, v, region.context, region),
        widen: spec.widen && ((a, b, block) => spec.widen!(a, b, block, region.context, region)),
        widenAfter: spec.widenAfter,
        edge: spec.edge && ((from, to, v) => spec.edge!(from, to, v, region.context, region)),
        strategy: spec.strategy,
        maxIterations: spec.maxIterations,
      });
      const enc = (m: ReadonlyMap<string, V>) =>
        Object.fromEntries(
          [...m]
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, spec.lattice.encode(v)]),
        );
      regions[region.id] = {
        in: enc(solution.in),
        out: enc(solution.out),
        iterations: solution.iterations,
        rounds: solution.rounds,
        loopHeads: solution.loopHeads,
      };
    }
    return immutable({ analysis: spec.id, direction: spec.direction, regions });
  };
  const definition = defineAnalysis<S, DataflowResult>({
    id: spec.id,
    version: spec.version,
    description: spec.description,
    input: spec.input,
    output,
    run: (_ctx, subject, params) => solveArtifact(subject, params),
    transfer: {
      id: `${spec.id}.unchanged-reads`,
      version: '1',
      verify(_ctx, { from, to }): CheckResult {
        const changes = diff(openIR(from, spec.adapter), openIR(to, spec.adapter));
        const touched = readsTouched(spec.reads, changes);
        return touched.length
          ? {
              ok: false,
              reason: `the change touches what ${spec.id} reads`,
              evidence: { touched: touched.slice(0, 50) },
            }
          : {
              ok: true,
              reason: `no entity or relation that ${spec.id} reads changed`,
              evidence: {
                reads: spec.reads,
                changedEntities: changes.entities.length,
                changedRelations: changes.relations.length,
              },
            };
      },
    },
  });
  return Object.assign(Object.create(null), definition, {
    spec,
    solveArtifact,
    decode(result: DataflowResult, region: string): Solution<V> {
      const r = result.regions[region];
      if (!r) throw new Error(`${spec.id} has no region ${region}`);
      const dec = (m: Readonly<Record<string, Json>>) =>
        new Map(Object.entries(m).map(([k, v]) => [k, spec.lattice.decode(v)]));
      return {
        in: dec(r.in),
        out: dec(r.out),
        iterations: r.iterations,
        rounds: r.rounds ?? 0,
        loopHeads: r.loopHeads,
      };
    },
  }) as DataflowAnalysis<S, V>;
}

/** Build a flow graph from an IR view: blocks are given, edges are the adapter's control relations. */
export function flowGraphOf(view: IRView<any>, entry: string, blocks: readonly string[]): FlowGraph {
  const set = new Set(blocks),
    succ = new Map<string, string[]>(),
    preds = new Map<string, string[]>();
  for (const b of blocks) {
    succ.set(b, []);
    preds.set(b, []);
  }
  const control = new Set(
    Object.entries(view.descriptor.relationKinds)
      .filter(([, c]) => c === 'control')
      .map(([k]) => k),
  );
  const edges = view
    .relations()
    .filter(r => control.has(r.kind) && set.has(r.from) && set.has(r.to))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : (a.order ?? 0) - (b.order ?? 0)));
  for (const r of edges) {
    succ.get(r.from)!.push(r.to);
    preds.get(r.to)!.push(r.from);
  }
  return { entry, blocks, succ: b => succ.get(b) ?? [], preds: b => preds.get(b) ?? [] };
}
