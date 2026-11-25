/**
 * A program and its revision timeline: the host the workbench, project scripts and the agent talk to (P3.1,
 * extensions E8 handles and E9 revisions). A port of the program handle in Compiler Workbench's api.js, on the
 * framework: every revision r0…rN is an immutable `typed.blocks` artifact, passes run through `applyPass` with the
 * optimization contract against r0, facts come from the analysis manager, and `undo`/`checkout` move the head back
 * by dropping later revisions (as the prototype does). Because older revisions are intact artifacts, provenance
 * queries resolve an id by looking from the head backwards, so a removed statement still reads as it was.
 *
 * Methods that run passes, analyses or checks are async (the framework's analyses and contracts are).
 */
import { AnalysisManager } from '../framework/contracts/analysis-manager.js';
import type { Artifact } from '../framework/core/types.js';
import type { EntityCorrespondence } from '../framework/ir/types.js';
import { whyEntity, type WhyNode } from '../framework/ir/correspondence.js';
import { applyPass } from '../framework/passes/define-pass.js';
import { ANALYSES } from './analyses.js';
import {
  agrees,
  benchCase,
  casesFrom,
  evaluate,
  meaningKept,
  outcome,
  readBuffer,
  type ProgramInputs,
  type RunResult,
} from './evaluate.js';
import { storeOf } from './ir.js';
import { LiftError } from './lift.js';
import { describeText, lineage, linesOf, listing } from './listing.js';
import type { TypedBlocks } from './model.js';
import { optimizationContract, PASSES, PIPELINES, type RevisionReport, type TypedPass } from './passes.js';
import { ingestProject, projectSource, type ProjectSource } from './project.js';
import { USER_PASSES } from './builder.js';
import type { Edit } from './tx.js';
import { createIRArtifact } from '../framework/ir/adapters.js';
import { blocksAdapter } from './ir.js';
import { ingest, type IngestOptions } from './lift.js';

export class WorkbenchError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fix?: string,
  ) {
    super(`[${code}] ${message}${fix ? `\n  fix: ${fix}` : ''}`);
    this.name = 'WorkbenchError';
  }
}
const fail = (code: string, message: string, fix?: string): never => {
  throw new WorkbenchError(code, message, fix);
};

export interface Revision {
  readonly rev: number;
  readonly pass: string;
  readonly artifact: Artifact<TypedBlocks>;
  readonly edits: readonly Edit[];
  readonly correspondence?: EntityCorrespondence;
  readonly ms: number;
  readonly fns?: readonly string[];
  readonly note?: string;
  /** The assumptions in force when this revision was made (see `Program.assume`). */
  readonly assumptions?: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface ApplyResult {
  readonly pass: string;
  readonly rev: string;
  readonly edits: number;
  readonly changed: boolean;
  readonly kinds?: Readonly<Record<string, number>>;
  readonly ms: number;
  readonly check?: string;
}

const revNumber = (r: number | string) => (typeof r === 'string' ? +r.replace(/^r/, '') : r);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class Program {
  readonly manager = new AnalysisManager();
  readonly revisions: Revision[] = [];
  status: 'ok' | 'frontEndError' | 'unsupported' = 'ok';
  error: { message: string; line?: number; col?: number } | null = null;
  constructor(
    readonly name: string,
    readonly source: string,
    readonly options: {
      inputs?: ProgramInputs;
      fileMap?: ProjectSource['fileMap'];
      project?: string;
      /** How to ingest: from the tape (`{ tape: true, maxSourceLength }`, e.g. for Candela) or by default. */
      ingest?: IngestOptions;
    } = {},
  ) {
    let r0: Artifact<TypedBlocks>;
    try {
      r0 = createIRArtifact(blocksAdapter, name, ingest(name, source, options.ingest).toNative());
    } catch (e) {
      if (!(e instanceof LiftError)) throw e;
      this.status = e.code === 'unsupportedOp' ? 'unsupported' : 'frontEndError';
      this.error = { message: e.message, ...(e.at ?? {}) };
      r0 = createIRArtifact(blocksAdapter, name, {
        formatVersion: 1,
        program: name,
        rev: 0,
        counters: {},
        fnOrder: [],
        fns: {},
        blocks: {},
        stmts: {},
        values: {},
        ops: {},
        frontEnd: { wasmBytes: 0, records: null, enums: null, signatures: null },
      });
    }
    this.revisions.push({
      rev: 0,
      pass: 'ingest',
      artifact: r0,
      edits: [],
      ms: 0,
      note: 'ingest from the typed front end',
    });
  }

  static fromProject(p: ProjectSource): Program {
    return new Program(p.name, p.source, { inputs: p.meta.inputs, fileMap: p.fileMap, project: p.id });
  }

  get id(): string {
    return `prog:${this.name}`;
  }
  /** Parameter values every check now assumes (set by `assume`, e.g. from a specialization's outer facts). */
  readonly assumptions: Record<string, Record<string, number>> = {};
  /** The case inputs checks use: the project's specifications, with assumed parameters fixed. */
  get inputs(): ProgramInputs {
    const base = this.options.inputs ?? {};
    const out: Record<string, Record<string, unknown>> = Object.fromEntries(
      Object.entries(base).map(([f, v]) => [f, { ...v }]),
    );
    for (const [f, params] of Object.entries(this.assumptions)) out[f] = { ...(out[f] ?? {}), ...params };
    return out as ProgramInputs;
  }
  /**
   * Restrict the program's meaning to inputs satisfying `bindings`: from now on the contract every pass must meet,
   * and every check, compares with r0 only on such inputs. Returns the previous assumptions (for `unassume`).
   */
  assume(
    bindings: readonly { fn: string; param: string; value: number }[],
  ): Record<string, Record<string, number>> {
    const previous = JSON.parse(JSON.stringify(this.assumptions));
    for (const b of bindings) {
      this.fname(b.fn);
      (this.assumptions[b.fn] ??= {})[b.param] = b.value;
    }
    return previous;
  }
  /** Specialize on an outer artifact's facts: assume them, then apply the `specialize` pass under that contract. */
  async specialize(bindings: Artifact<import('./specialize.js').Bindings>): Promise<ApplyResult> {
    const { specialize } = await import('./specialize.js');
    const previous = this.assume(bindings.value.bindings);
    try {
      return await this.apply(specialize, { params: { bindings } });
    } catch (e) {
      for (const k of Object.keys(this.assumptions)) delete this.assumptions[k];
      Object.assign(this.assumptions, previous);
      throw e;
    }
  }
  get rev(): number {
    return this.revisions.length - 1;
  }
  get head(): Artifact<TypedBlocks> {
    return this.revisions[this.rev].artifact;
  }
  get origin(): Artifact<TypedBlocks> {
    return this.revisions[0].artifact;
  }
  private requireOk(): void {
    if (this.status !== 'ok') fail('notCompiled', `${this.id} did not compile: ${this.error?.message}`);
  }
  artifact(rev: number | string = this.rev): Artifact<TypedBlocks> {
    const n = revNumber(rev);
    if (!(n >= 0 && n <= this.rev)) fail('noRevision', `${this.id} has revisions r0 to r${this.rev}`);
    return this.revisions[n].artifact;
  }

  // ---- structure ----
  fns(): string[] {
    return [...this.head.value.fnOrder];
  }
  private fname(fn?: string): string {
    const names = this.fns();
    if (fn === undefined) return names[0] ?? fail('unknownFunction', `${this.id} has no functions`);
    if (!names.includes(fn))
      fail('unknownFunction', `${this.id} has no function "${fn}"`, `functions: ${names.join(', ')}`);
    return fn;
  }
  listing(fn?: string): string {
    this.requireOk();
    return listing(storeOf(this.head.value), fn === undefined ? undefined : this.fname(fn));
  }
  has(id: string): boolean {
    return this.lookup(id) !== undefined;
  }

  // ---- the pass manager ----
  resolvePass(x: string | TypedPass): TypedPass {
    if (typeof x !== 'string') return x;
    return (
      PASSES[x] ??
      USER_PASSES.get(x) ??
      fail(
        'unknownPass',
        `no pass named "${x}"`,
        `passes: ${[...Object.keys(PASSES), ...USER_PASSES.keys()].join(', ')}`,
      )
    );
  }
  /** Apply one pass as one revision; checked against r0 unless `check: false`. Nothing changes on rejection. */
  async apply(
    x: string | TypedPass,
    opts: { params?: Record<string, unknown>; check?: boolean; count?: number; seed?: number } = {},
  ): Promise<ApplyResult> {
    this.requireOk();
    const pass = this.resolvePass(x),
      t0 = now();
    const contract =
      opts.check === false
        ? undefined
        : optimizationContract({ inputs: this.inputs, count: opts.count ?? 40, seed: opts.seed ?? 7 });
    const r = await applyPass(pass, this.head, {
      manager: this.manager,
      params: opts.params,
      contract,
      contractInputs: { origin: this.origin },
    });
    const ms = +(now() - t0).toFixed(2);
    if (!r.changed) return { pass: pass.typed.name, rev: `r${this.rev}`, edits: 0, changed: false, ms };
    const report = r.report as RevisionReport;
    this.revisions.push({
      rev: this.rev + 1,
      pass: pass.typed.name,
      artifact: r.artifact,
      edits: report.edits,
      correspondence: r.correspondence,
      ms,
      fns: report.fns,
      assumptions: JSON.parse(JSON.stringify(this.assumptions)),
    });
    const checks =
      (r.contract as { execution?: { checks?: { phase: string; evidence?: any }[] } } | undefined)?.execution
        ?.checks ?? [];
    const evidence = checks.find(c => c.phase === 'ensures' && c.evidence?.method === 'sampled')?.evidence as
      | { agree: number; total: number; inconclusive: number }
      | undefined;
    return {
      pass: pass.typed.name,
      rev: `r${this.rev}`,
      edits: report.edits.length,
      changed: true,
      kinds: report.kinds,
      ms,
      ...(evidence ? { check: `${evidence.agree}/${evidence.total - evidence.inconclusive}` } : {}),
    };
  }
  /** What would a pass change now? Runs it without the gate and publishes nothing. */
  async dryRun(x: string | TypedPass): Promise<{
    pass: string;
    edits: number;
    kinds: Record<string, number>;
    changes: unknown[];
    error?: string;
  }> {
    const pass = this.resolvePass(x);
    try {
      const r = await applyPass(pass, this.head, { manager: this.manager });
      const report = r.report as RevisionReport | undefined;
      return {
        pass: pass.typed.name,
        edits: r.edits,
        kinds: { ...(report?.kinds ?? {}) },
        changes: (report?.edits ?? []).map(e => ({
          fn: e.fn,
          kind: e.kind,
          ...(e.from ? { from: e.from } : {}),
          ...(e.text ? { text: e.text } : {}),
          ...(e.because ? { because: e.because } : {}),
          ...(e.note ? { note: e.note } : {}),
        })),
      };
    } catch (e) {
      return { pass: pass.typed.name, edits: 0, kinds: {}, changes: [], error: (e as Error).message };
    }
  }
  /** Passes that would change the program now (the prototype's "actions"), excluding the deliberately wrong one. */
  async actions(): Promise<{ pass: string; edits: number; kinds: Record<string, number> }[]> {
    this.requireOk();
    const out = [];
    for (const name of Object.keys(PASSES).filter(n => n !== 'div-to-shift')) {
      const r = await this.dryRun(name);
      if (r.edits > 0) out.push({ pass: r.pass, edits: r.edits, kinds: r.kinds });
    }
    return out;
  }
  async pipeline(
    x: string | readonly string[] = 'O2',
    opts: { count?: number; enabled?: Record<string, boolean> } = {},
  ) {
    this.requireOk();
    const names =
      typeof x === 'string'
        ? (PIPELINES[x] ??
          fail('unknownPipeline', `no pipeline "${x}"`, `pipelines: ${Object.keys(PIPELINES).join(', ')}`))
        : x;
    const steps = [];
    for (const name of names) {
      if (opts.enabled && opts.enabled[name] === false) {
        steps.push({ pass: name, skipped: true });
        continue;
      }
      try {
        steps.push(await this.apply(name, { count: opts.count }));
      } catch (e) {
        if ((e as { code?: string }).code !== 'contractRejected') throw e;
        steps.push({
          pass: name,
          rev: `r${this.rev}`,
          edits: 0,
          changed: false,
          rejected: (e as Error).message.split('\n')[0],
        });
      }
    }
    return {
      kind: 'pipelineRun',
      pipeline: typeof x === 'string' ? x : 'adhoc',
      program: this.id,
      rev: `r${this.rev}`,
      steps,
    };
  }
  undo(): string {
    if (this.rev === 0) fail('noRevision', 'nothing to undo: this is r0');
    return this.checkout(this.rev - 1);
  }
  checkout(rev: number | string): string {
    const n = revNumber(rev);
    if (!(n >= 0 && n <= this.rev)) fail('noRevision', `${this.id} has revisions r0 to r${this.rev}`);
    this.revisions.length = n + 1;
    // the head's assumptions: a specialization undone takes its restriction with it
    for (const k of Object.keys(this.assumptions)) delete this.assumptions[k];
    Object.assign(this.assumptions, JSON.parse(JSON.stringify(this.revisions[n].assumptions ?? {})));
    return `r${this.rev}`;
  }
  revisionList() {
    return this.revisions.map(r => ({
      rev: `r${r.rev}`,
      pass: r.pass,
      edits: r.edits.length,
      ms: r.ms,
      revision: r.artifact.revision,
      ...(r.note ? { note: r.note } : {}),
      ...(r.fns ? { fns: r.fns } : {}),
    }));
  }
  edits(rev: number | string = this.rev): Edit[] {
    const n = revNumber(rev);
    const r = this.revisions[n] ?? fail('noRevision', `${this.id} has r0 to r${this.rev}`);
    return r.edits.map(e => ({ ...e }));
  }
  diff(a: number | string = 0, b: number | string = this.rev) {
    return this.revisions.slice(revNumber(a) + 1, revNumber(b) + 1).flatMap(r =>
      r.edits.map(e => ({
        id: e.id,
        pass: e.pass,
        fn: e.fn,
        kind: e.kind,
        ...(e.stmt ? { stmt: e.stmt } : {}),
        ...(e.from ? { from: e.from } : {}),
        ...(e.to ? { to: e.to } : {}),
        ...(e.note ? { note: e.note } : {}),
      })),
    );
  }

  // ---- provenance ----
  /** The entity with this id at the newest revision that has it (and that revision). */
  lookup(id: string): { entity: any; rev: number } | undefined {
    for (let i = this.rev; i >= 0; i--) {
      const st = storeOf(this.revisions[i].artifact.value);
      if (st.has(id)) return { entity: st.get(id), rev: i };
    }
    return undefined;
  }
  statusOf(id: string): string {
    const found = this.lookup(id);
    if (!found) return 'absent';
    const e = found.entity;
    if (e.kind === 'op' || e.kind === 'function') return 'live';
    if (found.rev === this.rev && storeOf(this.head.value).liveIds().has(id)) return 'live';
    const removed = this.revisions.find(r => r.edits.some(x => x.kind === 'remove' && x.stmt === id));
    if (removed) return `removed@r${removed.rev}`;
    const replaced = this.revisions.find(r => r.edits.some(x => x.from === id));
    if (replaced) return `replaced@r${replaced.rev}`;
    return 'detached';
  }
  text(id: string): string {
    const found =
      this.lookup(id) ??
      fail(
        'absent',
        `${id} does not exist in ${this.id}`,
        'ids look like fn:name, bb:name.3, s:name.7, v:name.12, op:name#5',
      );
    return describeText(storeOf(this.revisions[found.rev].artifact.value), id);
  }
  lineage(id: string): string[] {
    return lineage(x => this.lookup(x)?.entity, id);
  }
  lines(id: string): number[] {
    return linesOf(x => this.lookup(x)?.entity, id);
  }
  /** The because-chain from origin records: { id, kind, text, status, via, rev, note, from, because, value }. */
  why(id: string, depth = 0, seen = new Set<string>()): Record<string, unknown> {
    const found = this.lookup(id);
    if (!found) return { id, status: 'absent' };
    const e = found.entity;
    const node: Record<string, unknown> = {
      id,
      kind: e.kind,
      text: this.text(id),
      status: this.statusOf(id),
    };
    if (seen.has(id) || depth > 8) return node;
    seen.add(id);
    const o = (e.origin || [])[0];
    if (o) {
      node.via = o.via;
      if (o.rev !== undefined) node.rev = o.rev;
      if (o.note) node.note = o.note;
      if (e.kind !== 'op') {
        node.from = o.from && o.from !== 'source' ? this.why(o.from, depth + 1, seen) : o.from;
        if (o.because && o.because.length)
          node.because = o.because.map((b: string) => (this.lookup(b) ? this.why(b, depth + 1, seen) : b));
      }
    }
    if (e.kind === 'stmt' && e.value && depth < 3) node.value = this.why(e.value, depth + 1, seen);
    return node;
  }
  /** The framework's view of the same question: walk the revision correspondences backwards (E2). */
  whyChain(id: string): readonly WhyNode[] {
    const chain = this.revisions
      .slice(1)
      .map(r => r.correspondence!)
      .filter(Boolean);
    return whyEntity({ artifact: this.head.id, revision: this.head.revision, entity: id }, chain);
  }
  /** Edits that mention an entity, across revisions. */
  history(id: string): Edit[] {
    return this.revisions.flatMap(r =>
      r.edits.filter(x => Object.values(x).some(v => v === id || (Array.isArray(v) && v.includes(id)))),
    );
  }

  // ---- facts ----
  async fact(name: keyof typeof ANALYSES, fn?: string): Promise<{ id: string; rev: string; value: unknown }> {
    this.requireOk();
    const def =
      ANALYSES[name] ??
      fail(
        'unknownAnalysis',
        `no analysis named "${String(name)}"`,
        `analyses: ${Object.keys(ANALYSES).join(', ')}`,
      );
    const f = this.fname(fn);
    const record = await this.manager.analyse(def as never, this.head);
    const value = record.value as { regions?: Record<string, unknown> } & Record<string, unknown>;
    return {
      id: `fact:${name}(${f})@r${this.rev}`,
      rev: `r${this.rev}`,
      value: value.regions ? value.regions[f] : value[f],
    };
  }

  // ---- runs and checks ----
  cases(fn?: string, opts: { count?: number; seed?: number; inputs?: Record<string, unknown> } = {}) {
    const f = this.fname(fn);
    return casesFrom(storeOf(this.head.value), f, {
      count: opts.count ?? 20,
      seed: opts.seed ?? 7,
      inputs: { ...(this.inputs[f] ?? {}), ...(opts.inputs ?? {}) } as never,
    }).map(c => ({ n: c.n, args: c.args, items: c.items }));
  }
  private argSpec(type: string, v: unknown): unknown {
    const fe =
      (this.head.value.frontEnd as {
        records?: Record<string, unknown>;
        enums?: Record<string, Record<string, number>>;
      }) ?? {};
    const enums = fe.enums ?? {},
      records = fe.records ?? {};
    if (enums[type] && typeof v === 'string') {
      if (!(v in enums[type]))
        fail('badArgument', `${type} has no case "${v}"`, `cases: ${Object.keys(enums[type]).join(', ')}`);
      return enums[type][v];
    }
    if (
      records[type] &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      !(v as { record?: unknown }).record
    )
      return {
        record: Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, [(x as number) | 0, (x as number) | 0]]),
        ),
      };
    if (Array.isArray(v)) return { cells: v };
    if (typeof v === 'string') return { string: v };
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v ?? 0;
  }
  /** One call on the evaluator: positional args or named; buffers as arrays, strings as text. */
  exec(
    fn: string | undefined,
    args: readonly unknown[] | Record<string, unknown> = [],
    opts: { limit?: number; counts?: boolean } = {},
  ) {
    this.requireOk();
    const f = this.fname(fn),
      st = storeOf(this.head.value),
      F = st.fn(f);
    const list = Array.isArray(args)
      ? args
      : F.params.map((_, i) => (args as Record<string, unknown>)[F.locals[i].name]);
    const bench: Record<string, unknown> = {};
    F.params.forEach((t, i) => (bench[F.locals[i].name] = this.argSpec(t, list[i])));
    const c = benchCase(st, f, bench);
    const r = evaluate(st, f, c.args, c.memory, { limit: opts.limit ?? 5e6, counts: !!opts.counts });
    return {
      kind: 'run',
      engine: r.engine,
      fn: f,
      args: c.args,
      result: r.result,
      trap: r.trap,
      steps: r.steps,
      unit: r.unit,
      buffers: c.items
        .filter(x => x.kind === 'buffer')
        .map(x => ({ name: x.name, at: x.at, cells: readBuffer(r.bytes, x.at).slice(0, 64) })),
      ...(opts.counts && r.counts ? { counts: Object.fromEntries(r.counts) } : {}),
    };
  }
  /**
   * The head against r0 per function (Compiler Workbench's `p.check()`): agree / decided, traps on both sides,
   * step-limit hits, counterexamples. `against` may be a function that runs another engine on a case.
   */
  check(
    opts: {
      fn?: string;
      count?: number;
      seed?: number;
      against?: (fn: string, c: ReturnType<typeof casesFrom>[number]) => RunResult;
    } = {},
  ) {
    this.requireOk();
    const head = storeOf(this.head.value),
      base = storeOf(this.origin.value);
    const rows = (opts.fn ? [this.fname(opts.fn)] : this.fns()).map(f => {
      const cases = casesFrom(head, f, {
        count: opts.count ?? 100,
        seed: opts.seed ?? 7,
        inputs: this.inputs[f] ?? {},
      });
      let agree = 0,
        bothTrap = 0,
        inconclusive = 0;
      const counterexamples: unknown[] = [];
      for (const c of cases) {
        const expected = opts.against
          ? evaluate(head, f, c.args, c.memory, { limit: 2e4 })
          : evaluate(base, f, c.args, c.memory, { limit: 2e4 });
        const got = opts.against ? opts.against(f, c) : evaluate(head, f, c.args, c.memory, { limit: 2e4 });
        if (expected.limit || got.limit) {
          inconclusive++;
          continue;
        }
        if (agrees(expected, got)) {
          agree++;
          if (expected.trap) bothTrap++;
        } else if (counterexamples.length < 5)
          counterexamples.push({
            n: c.n,
            args: c.args,
            expected: outcome(expected),
            got: got.fault ? `fault: ${got.trap}` : outcome(got),
          });
      }
      const decided = cases.length - inconclusive;
      return {
        fn: f,
        rev: `r${this.rev}`,
        agree,
        total: decided,
        bothTrap,
        inconclusive,
        status: decided === 0 ? 'inconclusive' : agree === decided ? 'agree' : 'disagree',
        counterexamples,
      };
    });
    return {
      kind: 'check',
      program: this.id,
      rev: `r${this.rev}`,
      status: rows.every(r => r.status !== 'disagree') ? 'agree' : 'disagree',
      fns: rows,
    };
  }
  /** The framework invariant behind `check`: one evidence record for the whole program (E5). */
  async verify(opts: { count?: number; seed?: number } = {}) {
    return this.manager.checkInvariant(
      meaningKept({ inputs: this.inputs, count: opts.count ?? 100, seed: opts.seed ?? 7 }),
      { origin: this.origin, candidate: this.head },
    );
  }
}

/** The workbench root: programs by name, projects, and the catalogue of passes, analyses and pipelines. */
export function createWorkbench() {
  const programs = new Map<string, Program>();
  let current: Program | null = null;
  return {
    program(name: string, source: string, opts: { inputs?: ProgramInputs } = {}): Program {
      const p = new Program(name, source, opts);
      programs.set(name, p);
      current = p;
      return p;
    },
    open(id: string, files: Readonly<Record<string, string>>): Program {
      const p = Program.fromProject(projectSource(id, files));
      programs.set(p.name, p);
      current = p;
      return p;
    },
    get current(): Program | null {
      return current;
    },
    programs() {
      return [...programs.values()].map(q => ({
        name: q.name,
        status: q.status,
        rev: `r${q.rev}`,
        project: q.options.project ?? null,
      }));
    },
    pipelines() {
      return Object.fromEntries(
        Object.entries(PIPELINES).map(([k, v]) => [k, v.join(' → ') || '(nothing: the lifted code as is)']),
      );
    },
    passes() {
      return Object.values(PASSES).map(x => ({
        name: x.typed.name,
        about: x.typed.about,
        needs: Object.values(x.typed.needs ?? {}),
        writes: x.typed.writes,
        preserves: x.typed.preserves ?? [],
      }));
    },
    analyses() {
      return Object.entries(ANALYSES).map(([name, a]) => ({ name, id: a.id, about: a.description }));
    },
  };
}

export { ingestProject };
