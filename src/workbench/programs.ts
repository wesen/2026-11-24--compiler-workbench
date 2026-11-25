/**
 * Programs as the workbench sees them: the kernel's `Program` (revisions r0…rN, provenance, checks) wrapped
 * with what the UI and scripts need on top — synchronous facts, compiled images, the project file map — and the
 * program and image handles (a port of the handles in Compiler Workbench's api.js).
 *
 * Async kernel calls (`apply`, `pipeline`, `dryRun`, `actions`, `verify`) behave in two ways. On a handle that
 * belongs to a `SyncContext` (scripts, queries, the console) they are synchronous: recorded outcomes replay, new
 * ones suspend the attempt (see sync.ts). On a free handle they return Promises.
 */
import type { Artifact } from '../framework/core/types.js';
import type { DataflowResult } from '../framework/dataflow/analysis.js';
import {
  cfgOf,
  dominatorsOf,
  domView,
  livenessAnalysis,
  liveView,
  loopsOf,
  rangesAnalysis,
  rangeView,
  reachingAnalysis,
  reachView,
  ANALYSES,
} from '../typed/analyses.js';
import {
  backendDefaults,
  checkBackendOptions,
  diffImages,
  diffOptions,
  heat as heatOf,
  imageStatus,
  lowerToImage,
  machineCode,
  runImage,
  type ImageInsn,
  type Rv32Image,
} from '../typed/backend/index.js';
import { benchCase, casesFrom, hash, readBuffer } from '../typed/evaluate.js';
import { storeOf } from '../typed/ir.js';
import { listing as listingOf } from '../typed/listing.js';
import type { Store, TypedBlocks, WorkFn } from '../typed/model.js';
import { PIPELINES, type TypedPass } from '../typed/passes.js';
import { Program, type Revision } from '../typed/program.js';
import { didYouMean, fail, guard, now } from './base.js';
import { handle, selection } from './entities.js';
import { keyOf, settle, unwrap, type Outcome, type SyncContext } from './sync.js';

// ---------- facts, computed synchronously with the kernel's own solvers ----------
export interface FactRecord {
  readonly id: string;
  readonly kind: 'fact';
  readonly analysis: string;
  readonly fn: string;
  readonly rev: string;
  readonly status: 'fresh';
  readonly value: any;
  readonly ms: number;
  readonly visits?: number;
}
type FactCompute = (art: Artifact<TypedBlocks>, st: Store, f: WorkFn) => any;
const solved = new WeakMap<object, Map<string, DataflowResult>>();
const solve = (
  a: { id: string; solveArtifact(x: Artifact<TypedBlocks>): DataflowResult },
  art: Artifact<TypedBlocks>,
) => {
  let m = solved.get(art);
  if (!m) solved.set(art, (m = new Map()));
  let r = m.get(a.id);
  if (!r) m.set(a.id, (r = a.solveArtifact(art)));
  return r;
};
/** A dataflow fact: the solution's in/out maps, plus the kernel's query view (liveAfter, reachingAt, at, of). */
const dataflowFact =
  (
    a: typeof livenessAnalysis | typeof reachingAnalysis | typeof rangesAnalysis,
    view: (r: DataflowResult, st: Store, fname: string) => object,
  ): FactCompute =>
  (art, st, f) => {
    const result = solve(a as any, art);
    const s = (a as any).decode(result, f.name);
    return { in: s.in, out: s.out, visits: s.iterations, rounds: s.rounds, ...view(result, st, f.name) };
  };
/** The built-in analyses by name, plus those `wb.analysis(name)…register()` adds. */
export const FACTS = new Map<
  string,
  { about: string; compute: FactCompute; user?: boolean; reads?: string[] }
>([
  [
    'cfg',
    {
      about: ANALYSES.cfg.description,
      compute: (_a, _s, f) => {
        const c = cfgOf(f);
        return {
          entry: c.entry,
          rpo: c.rpo,
          edges: c.edges,
          succ: new Map(Object.entries(c.succ)),
          preds: new Map(Object.entries(c.preds)),
        };
      },
    },
  ],
  [
    'dominators',
    {
      about: ANALYSES.dominators.description,
      compute: (_a, _s, f) => {
        const d = dominatorsOf(f),
          v = domView(d);
        return { idom: v.idom, children: v.children, dominates: v.dominates, rpo: d.rpo, visits: d.rounds };
      },
    },
  ],
  ['loops', { about: ANALYSES.loops.description, compute: (_a, st, f) => loopsOf(st, f) }],
  ['liveness', { about: ANALYSES.liveness.description, compute: dataflowFact(livenessAnalysis, liveView) }],
  ['reaching', { about: ANALYSES.reaching.description, compute: dataflowFact(reachingAnalysis, reachView) }],
  ['ranges', { about: ANALYSES.ranges.description, compute: dataflowFact(rangesAnalysis, rangeView) }],
]);

// ---------- images ----------
export interface ImageEnt {
  readonly id: string;
  readonly rev: number;
  readonly options: Record<string, unknown>;
  readonly artifact: Artifact<Rv32Image>;
  readonly value: Rv32Image;
  readonly ms: number;
  readonly byId: Map<string, ImageInsn>;
  readonly store: Store;
}

/** Positional or named arguments as the evaluator's input specs (the prototype's argSpec). */
export function argSpec(st: Store, type: string, v: unknown): unknown {
  const fe =
    (st.frontEnd as { records?: Record<string, unknown>; enums?: Record<string, Record<string, number>> }) ??
    {};
  const enums = fe.enums ?? {},
    records = fe.records ?? {};
  if (enums[type] && typeof v === 'string') {
    if (!(v in enums[type]))
      fail('badArgument', `${type} has no case "${v}"`, {
        fix: `cases: ${Object.keys(enums[type]).join(', ')}`,
      });
    return enums[type][v];
  }
  if (records[type] && v && typeof v === 'object' && !Array.isArray(v) && !(v as { record?: unknown }).record)
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
export function benchOf(st: Store, fname: string, args: readonly unknown[] | Record<string, unknown> = []) {
  const F = st.fn(fname),
    bench: Record<string, unknown> = {};
  const list = Array.isArray(args)
    ? args
    : F.params.map((_, i) => (args as Record<string, unknown>)[F.locals[i].name]);
  F.params.forEach((t, i) => (bench[F.locals[i].name] = argSpec(st, t, list[i])));
  return benchCase(st, fname, bench);
}

/** Images and facts depend only on the revision artifact: copies of a program (fresh copies, replays) share them. */
const imageCache = new WeakMap<object, ImageEnt[]>();
const factCache = new WeakMap<object, Map<string, FactRecord>>();

const chainSig = (chain: readonly Revision[]) => chain.map(r => r.artifact.revision.slice(0, 16)).join(',');
let uids = 0;

/** The kernel program plus the workbench's bookkeeping. */
export class WbProgram {
  readonly uid = ++uids;
  readonly spec: string;
  readonly images: ImageEnt[] = [];
  lastImage: ImageEnt | null = null;
  /** Outcomes of read-only async calls (dry runs), by content key, kept across contexts. */
  readonly readCache = new Map<string, Outcome>();
  constructor(
    readonly k: Program,
    readonly opts: {
      project?: string | null;
      scratch?: boolean;
      fileMap?: readonly { file: string; start: number; lines: number }[];
    } = {},
  ) {
    this.spec = hash(`${k.name}\u0000${k.source}\u0000${JSON.stringify(k.inputs)}`);
  }
  get id(): string {
    return `prog:${this.k.name}`;
  }
  get name(): string {
    return this.k.name;
  }
  get project(): string | null {
    return this.opts.project ?? null;
  }
  get scratch(): boolean {
    return !!this.opts.scratch;
  }
  get fileMap() {
    return this.opts.fileMap ?? this.k.options.fileMap ?? [];
  }
  get rev(): number {
    return this.k.rev;
  }
  get chain(): Revision[] {
    return this.k.revisions;
  }
  get sig(): string {
    return chainSig(this.k.revisions);
  }
  setChain(chain: readonly Revision[]): void {
    if (chain === this.k.revisions) return;
    this.k.revisions.length = 0;
    this.k.revisions.push(...chain);
  }
  /** A copy of the kernel program sharing everything but the revision list, for async work off to the side. */
  scratchKernel(chain: readonly Revision[] = this.k.revisions): Program {
    const s = Object.assign(Object.create(Object.getPrototypeOf(this.k)), this.k) as Program;
    Object.defineProperty(s, 'revisions', { value: chain.slice(), writable: true, enumerable: true });
    return s;
  }
  get head(): Store {
    return storeOf(this.k.head.value);
  }
  get ok(): boolean {
    return this.k.status === 'ok';
  }
  requireOk(): void {
    if (!this.ok) {
      const e = this.error;
      fail(
        'frontEndError',
        `${this.id} did not pass the front end` +
          (e && e.line ? ` (line ${e.line}:${e.col})` : '') +
          `: ${e && e.message}`,
        { fix: 'fix the source in its project file' },
      );
    }
  }
  get error(): { message: string; line?: number; col?: number; file?: string; fileLine?: number } | null {
    const e = this.k.error;
    if (!e) return null;
    const at = e.line ? this.locate(e.line) : null;
    return { ...e, ...(at ? { file: at.file, fileLine: at.line } : {}) };
  }
  locate(line: number): { file: string; line: number } {
    const m = this.fileMap;
    for (const f of m)
      if (line >= f.start && line < f.start + f.lines) return { file: f.file, line: line - f.start + 1 };
    return { file: m.length ? m[m.length - 1].file : 'main.typed', line };
  }
  fns(): string[] {
    return this.ok ? this.k.fns() : [];
  }
  fname(name?: string): string {
    this.requireOk();
    const names = this.fns();
    if (name === undefined) return names[0];
    if (!names.includes(name))
      fail(
        'unknownFunction',
        `${this.id} has no function "${name}".` +
          (didYouMean(name, names) ? ` Did you mean "${didYouMean(name, names)}"?` : ''),
        {
          fix: `functions: ${names.join(', ')}`,
        },
      );
    return name;
  }

  // ---- entities ----
  find(id: string): { entity: any; store: Store; rev: number } | undefined {
    const head = this.head;
    if (head.has(id)) return { entity: head.get(id), store: head, rev: this.rev };
    if (id.startsWith('insn:')) {
      const img = this.lastImage,
        x = img?.byId.get(id);
      return x && img
        ? { entity: { ...x, kind: 'insn', image: img.id }, store: img.store, rev: img.rev }
        : undefined;
    }
    const found = this.k.lookup(id);
    return found
      ? { entity: found.entity, store: storeOf(this.k.revisions[found.rev].artifact.value), rev: found.rev }
      : undefined;
  }
  has(id: string): boolean {
    return this.find(id) !== undefined;
  }
  statusOf(id: string): string {
    if (id.startsWith('insn:')) return this.lastImage?.byId.has(id) ? 'live' : 'absent';
    return this.k.statusOf(id);
  }
  text(id: string): string {
    if (id.startsWith('insn:')) {
      const x = this.lastImage?.byId.get(id);
      if (!x) fail('absent', `${id} does not exist in ${this.id}`);
      return x!.text;
    }
    return this.k.text(id);
  }
  lineage(id: string): string[] {
    if (id.startsWith('insn:'))
      return [...new Set((this.lastImage?.byId.get(id)?.covers ?? []).flatMap(c => this.k.lineage(c)))];
    return this.k.lineage(id);
  }
  lines(id: string): number[] {
    if (id.startsWith('insn:')) return this.k.lines(this.lastImage?.byId.get(id)?.covers[0] ?? '');
    return this.k.lines(id);
  }
  why(id: string): Record<string, unknown> {
    if (id.startsWith('insn:')) {
      const x = this.lastImage?.byId.get(id);
      if (!x) return { id, status: 'absent' };
      return {
        id,
        kind: 'insn',
        text: x.text,
        status: 'live',
        via: 'select',
        covers: x.covers.map(c => this.k.why(c)),
      };
    }
    return this.k.why(id);
  }
  history(id: string) {
    return this.k.history(id);
  }
  listing(fn?: string): string {
    this.requireOk();
    return listingOf(this.head, fn === undefined ? undefined : this.fname(fn));
  }
  /** Everything that came from an entity, by provenance: lines, live values and statements, instructions. */
  related(id: string): { lines: number[]; values: string[]; stmts: string[]; insns: string[] } {
    const out = {
      lines: [] as number[],
      values: [] as string[],
      stmts: [] as string[],
      insns: [] as string[],
    };
    const found = this.find(id);
    if (!found || !this.ok) return out;
    const e = found.entity,
      head = this.head,
      live = head.liveIds();
    const ops = e.kind === 'op' ? [id] : this.lineage(id);
    out.lines = e.kind === 'op' ? (e.at ? [e.at.line] : []) : this.lines(id);
    const own = (x: any) => (x.origin || []).some((o: any) => ops.includes(o.from)) || x.id === id;
    for (const x of head.ents.values()) {
      if (x.kind === 'value' && live.has(x.id) && (x.id === id || (e.kind === 'op' && own(x))))
        out.values.push(x.id);
      if (
        x.kind === 'stmt' &&
        live.has(x.id) &&
        (x.id === id || (e.kind === 'op' && this.k.lineage(x.id).includes(id)))
      )
        out.stmts.push(x.id);
    }
    const img = this.lastImage;
    if (img)
      for (const x of img.value.insns)
        if (x.id === id || x.covers.some(c => c === id || this.k.lineage(c).some(o => ops.includes(o))))
          out.insns.push(x.id);
    out.values = [...new Set(out.values)];
    return out;
  }

  // ---- facts ----
  fact(name: string, fn?: string): FactRecord {
    const a = FACTS.get(name);
    if (!a)
      fail(
        'unknownAnalysis',
        `no analysis named "${name}".` +
          (didYouMean(name, [...FACTS.keys()])
            ? ` Did you mean "${didYouMean(name, [...FACTS.keys()])}"?`
            : ''),
        {
          fix: `analyses: ${[...FACTS.keys()].join(', ')}`,
        },
      );
    const f = this.fname(fn),
      art = this.k.head,
      key = `${name}:${f}:${this.rev}`;
    let cache = factCache.get(art);
    if (!cache) factCache.set(art, (cache = new Map()));
    const hit = cache.get(key);
    if (hit) return hit;
    const t0 = now();
    const value = a!.compute(art, this.head, this.head.fn(f));
    const rec: FactRecord = {
      id: `fact:${name}(${f})@r${this.rev}`,
      kind: 'fact',
      analysis: name,
      fn: f,
      rev: `r${this.rev}`,
      status: 'fresh',
      value,
      ms: +(now() - t0).toFixed(2),
      ...(value && typeof value === 'object' && 'visits' in value ? { visits: value.visits } : {}),
    };
    cache.set(key, rec);
    return rec;
  }
  /** The facts computed for the head revision so far. */
  facts(): { id: string; status: string; ms: number; visits?: number }[] {
    return [...(factCache.get(this.k.head)?.values() ?? [])].map(f => ({
      id: f.id,
      status: f.status,
      ms: f.ms,
      ...(f.visits !== undefined ? { visits: f.visits } : {}),
    }));
  }

  // ---- the backend ----
  compile(opts: Record<string, unknown> = {}, rev: number = this.rev): ImageEnt {
    this.requireOk();
    const o = checkBackendOptions(opts);
    const art = this.k.artifact(rev);
    const changed = diffOptions(o);
    const okey = keyOf(changed);
    let shared = imageCache.get(art);
    if (!shared) imageCache.set(art, (shared = []));
    let img = shared.find(
      x => x.rev === rev && keyOf(x.options) === okey && x.id.startsWith(`img:${this.name}@`),
    );
    if (!img) {
      const t0 = now();
      const id =
        `img:${this.name}@r${rev}` + (Object.keys(changed).length ? `~${hash(okey).slice(0, 4)}` : '');
      const { image } = lowerToImage(art, o, { id });
      img = {
        id,
        rev,
        options: changed as Record<string, unknown>,
        artifact: image,
        value: image.value,
        ms: +(now() - t0).toFixed(2),
        byId: new Map(image.value.insns.map(x => [x.id, x])),
        store: storeOf(art.value),
      };
      shared.push(img);
    }
    if (!this.images.includes(img)) {
      this.images.push(img);
      if (this.images.length > 24) this.images.shift();
    }
    this.lastImage = img;
    return img;
  }
  imageStatus(img: ImageEnt): string {
    return imageStatus(
      img.artifact,
      this.k.revisions.map(r => r.artifact),
    );
  }
  image(id?: string): ImageEnt | null {
    if (!id) return this.lastImage;
    return (
      this.images.find(x => x.id === id) ??
      fail('absent', `no image ${id} in ${this.id}`, { fix: 'p.compile() makes one' })
    );
  }
}

// ---------- the handles ----------
/** What a handle needs from the workbench root. */
export interface HandleEnv {
  emit(event: string, data?: unknown): void;
  /** Refuse a change in read-only contexts (queries, the agent's Read-only mode). */
  writes(what: string, ctx: SyncContext | null, p?: WbProgram): void;
  focus(id: string | null, p: WbProgram, ctx: SyncContext | null): unknown;
  resolvePass(x: unknown): TypedPass;
  replace(p: WbProgram, source: string): WbProgram;
  programHandle(p: WbProgram, ctx: SyncContext | null): any;
}

const revNumber = (r: number | string | undefined, dflt: number) =>
  r === undefined ? dflt : typeof r === 'string' ? +r.replace(/^r/, '') : r;

/** The program handle a script, the console, the agent or a view gets. */
export function makeProgramHandle(p: WbProgram, env: HandleEnv, ctx: SyncContext | null): any {
  const k = p.k;
  const changed = (what: string, r: unknown) => {
    env.emit('revision', { program: p.name, what, rev: p.rev, result: r });
    return r;
  };
  const passKey = (x: unknown) => {
    const pass = env.resolvePass(x);
    return {
      pass,
      key: `${pass.typed.name}${(pass as any)._user ? '#' + hash(String((pass as any)._user)) : ''}`,
    };
  };
  /** A change made through the async kernel: on a scratch copy, then replayed onto this program. */
  const mutate = <T>(what: string, key: string, run: (scratch: Program) => Promise<T>): T | Promise<T> => {
    env.writes(what, ctx, p);
    p.requireOk();
    if (!ctx || ctx.closed)
      return (async () => {
        const scratch = p.scratchKernel();
        const r = await run(scratch);
        p.setChain(scratch.revisions);
        return changed(what, r) as T;
      })();
    ctx.touch(p, () => {
      const saved = p.chain.slice();
      return () => p.setChain(saved);
    });
    const at = p.chain.slice();
    return ctx.op(
      `${what} on ${p.id}`,
      `${what}|${p.spec}|${chainSig(at)}|${key}`,
      () =>
        settle(async () => {
          const scratch = p.scratchKernel(at);
          const result = await run(scratch);
          return { result, chain: scratch.revisions.slice() };
        }),
      o => {
        const v = unwrap(o) as { result: T; chain: Revision[] };
        p.setChain(v.chain);
        return changed(what, v.result) as T;
      },
    );
  };
  /** A read-only async question (a dry run): cached by content on the program across contexts. */
  const ask = <T>(what: string, key: string, run: (scratch: Program) => Promise<T>): T | Promise<T> => {
    p.requireOk();
    const full = `${what}|${p.spec}|${p.sig}|${key}`;
    const at = p.chain.slice();
    const compute = () => settle(() => run(p.scratchKernel(at)));
    const remember = (o: Outcome) => {
      if (p.readCache.size > 200) p.readCache.clear();
      p.readCache.set(full, o);
      return o;
    };
    const hit = p.readCache.get(full);
    if (hit) return unwrap(hit) as T;
    if (!ctx || ctx.closed) return compute().then(o => unwrap(remember(o)) as T);
    return ctx.op(
      `${what} on ${p.id}`,
      full,
      async () => remember(await compute()),
      o => unwrap(o) as T,
    );
  };
  const imageEnt = (x: unknown) =>
    typeof x === 'string'
      ? p.image(x)!
      : ((x as { _img?: ImageEnt })?._img ?? p.image((x as { id: string }).id)!);
  const fname = (n?: string) => p.fname(n);

  const P = {
    get id() {
      return p.id;
    },
    get name() {
      return p.name;
    },
    get source() {
      return k.source;
    },
    get status() {
      return k.status;
    },
    get error() {
      return p.error;
    },
    get rev() {
      return `r${p.rev}`;
    },
    get inputs() {
      return JSON.parse(JSON.stringify(k.inputs || {}));
    },
    get project() {
      return p.project;
    },
    files() {
      return p.fileMap.map(f => ({ ...f }));
    },
    locate(line: number) {
      return p.locate(line);
    },
    where(id: string) {
      return p.lines(id).map(n => {
        const at = p.locate(n);
        return `${at.file}:${at.line}`;
      });
    },
    fns() {
      return p.fns();
    },
    fn(name?: string) {
      return handle(p, `fn:${fname(name)}`);
    },
    get(id: string) {
      return handle(p, id);
    },
    has(id: string) {
      return p.has(id);
    },
    describe() {
      if (!p.ok) return { id: p.id, status: k.status, error: p.error };
      const st = p.head;
      return {
        id: p.id,
        status: k.status,
        rev: `r${p.rev}`,
        project: p.project,
        files: p.fileMap.map(f => f.file),
        fns: p.fns().map(n => {
          const f = st.fn(n);
          return {
            name: f.name,
            signature: `${f.name}(${f.params.map((t, i) => `${f.locals[i].name}: ${t}`).join(', ')}): ${f.result}`,
            blocks: f.blocks.length,
            stmts: f.blocks.reduce((m, b) => m + b.stmts.length, 0),
            locals: f.locals.length,
          };
        }),
        revisions: k.revisions.length,
        image: p.lastImage?.id ?? null,
      };
    },
    listing(name?: string) {
      return p.listing(name);
    },

    // ---- the pass manager (async in the kernel) ----
    apply(
      pass: unknown,
      opts: { params?: Record<string, unknown>; check?: boolean; count?: number; seed?: number } = {},
    ) {
      const { pass: x, key } = passKey(pass);
      return mutate('apply', `${key}|${keyOf(opts)}`, s => s.apply(x, opts));
    },
    dryRun(pass: unknown) {
      const { pass: x, key } = passKey(pass);
      return ask('dryRun', key, s => s.dryRun(x));
    },
    actions() {
      return ask('actions', '', s => s.actions());
    },
    pipeline(
      x: string | readonly string[] | { passes: readonly string[]; checkEach?: boolean } = 'O2',
      opts: { count?: number; enabled?: Record<string, boolean>; checkEach?: boolean } = {},
    ) {
      let names: readonly string[];
      let checkEach = opts.checkEach !== false;
      if (typeof x === 'string') {
        if (!PIPELINES[x]) {
          const near = didYouMean(x, Object.keys(PIPELINES));
          fail('unknownPipeline', `no pipeline "${x}".` + (near ? ` Did you mean "${near}"?` : ''), {
            fix: `pipelines: ${Object.keys(PIPELINES).join(', ')}, or a list of pass names`,
          });
        }
        names = PIPELINES[x];
      } else if (Array.isArray(x)) names = x as string[];
      else {
        names = (x as { passes: string[] }).passes;
        if ((x as { checkEach?: boolean }).checkEach === false) checkEach = false;
      }
      for (const n of names) env.resolvePass(n);
      const label = typeof x === 'string' ? x : 'adhoc';
      return mutate('pipeline', `${label}|${names.join(',')}|${checkEach}|${keyOf(opts)}`, async s => {
        if (checkEach && !opts.enabled) {
          const r = await s.pipeline(typeof x === 'string' ? x : names, { count: opts.count });
          return { ...r, pipeline: label };
        }
        // without the gate after each pass (Compiler Workbench's checkEach: false), or with steps switched off
        const steps: unknown[] = [];
        for (const name of names) {
          if (opts.enabled && opts.enabled[name] === false) {
            steps.push({ pass: name, skipped: true });
            continue;
          }
          try {
            steps.push(await s.apply(env.resolvePass(name), { check: checkEach, count: opts.count }));
          } catch (e) {
            if ((e as { code?: string }).code !== 'contractRejected') throw e;
            steps.push({
              pass: name,
              rev: `r${s.rev}`,
              edits: 0,
              changed: false,
              rejected: (e as Error).message.split('\n')[0],
            });
          }
        }
        return { kind: 'pipelineRun', pipeline: label, program: p.id, rev: `r${s.rev}`, steps };
      });
    },
    undo() {
      env.writes('undo', ctx, p);
      if (ctx)
        ctx.touch(p, () => {
          const saved = p.chain.slice();
          return () => p.setChain(saved);
        });
      return changed('undo', k.undo());
    },
    checkout(rev: number | string) {
      env.writes('checkout', ctx, p);
      if (ctx)
        ctx.touch(p, () => {
          const saved = p.chain.slice();
          return () => p.setChain(saved);
        });
      return changed('checkout', k.checkout(rev));
    },
    revisions() {
      return k.revisionList().map(r => ({
        rev: r.rev,
        pass: r.pass,
        edits: r.edits,
        ms: r.ms,
        ...(r.note ? { note: r.note } : {}),
        ...(r.fns ? { fns: r.fns } : {}),
      }));
    },
    edits(rev?: number | string) {
      return k.edits(revNumber(rev, p.rev));
    },
    diff(a: number | string = 0, b: number | string = p.rev) {
      return k.diff(a, b);
    },
    verify(opts: { count?: number; seed?: number } = {}) {
      return ask('verify', keyOf(opts), s => s.verify(opts));
    },
    edit(source: string) {
      env.writes('edit', ctx, p);
      if (p.project)
        fail('useProjectFiles', `${p.id} belongs to project "${p.project}": edit its files instead`, {
          fix: `project.files.write('${p.fileMap[0]?.file ?? 'main.typed'}', source)`,
        });
      return env.programHandle(env.replace(p, source), ctx);
    },

    // ---- facts ----
    facts() {
      return p.facts();
    },
    fact(name: string, fn?: string) {
      return P.fn(fn).fact(name);
    },

    // ---- provenance ----
    why(id: string) {
      return p.why(id);
    },
    lineage(id: string) {
      return p.lineage(id);
    },
    lines(id: string) {
      return p.lines(id);
    },
    related(id: string) {
      return p.related(id);
    },
    statusOf(id: string) {
      return p.statusOf(id);
    },
    text(id: string) {
      return p.text(id);
    },
    whyChain(id: string) {
      return k.whyChain(id);
    },

    // ---- runs and checks ----
    cases(fn?: string, opts: { count?: number; seed?: number; inputs?: Record<string, unknown> } = {}) {
      return k.cases(fname(fn), opts);
    },
    exec(
      fn: string | undefined,
      args: readonly unknown[] | Record<string, unknown> = [],
      opts: { engine?: string; image?: unknown; limit?: number; counts?: boolean } = {},
    ) {
      const f = fname(fn);
      const engine = opts.engine || (opts.image ? 'rv32' : 'evaluator');
      let out: Record<string, unknown>;
      if (engine === 'rv32') {
        const img = opts.image ? imageEnt(opts.image) : p.compile();
        const c = benchOf(p.head, f, args);
        const r = runImage(img.artifact, f, c.args, c.memory, { limit: opts.limit || 5e6 });
        out = {
          kind: 'run',
          engine: 'rv32',
          image: img.id,
          fn: f,
          args: c.args,
          result: r.result,
          trap: r.trap,
          steps: r.steps,
          unit: r.unit,
          ...(r.fault ? { fault: true } : {}),
          buffers: r.bytes.length
            ? c.items
                .filter(x => x.kind === 'buffer')
                .map(x => ({ name: x.name, at: x.at, cells: readBuffer(r.bytes, x.at).slice(0, 64) }))
            : [],
        };
      } else out = k.exec(f, args, { limit: opts.limit, counts: opts.counts });
      env.emit('run', { program: p.name, run: out });
      return out;
    },
    check(opts: { fn?: string; count?: number; seed?: number; against?: string; image?: unknown } = {}) {
      p.requireOk();
      const against = opts.against || 'r0';
      if (against === 'reference')
        fail(
          'noReference',
          `${p.id} has no reference image: reference images are not shipped in this build`,
          { fix: "check against 'r0' or 'image'" },
        );
      const img = against === 'image' ? (opts.image ? imageEnt(opts.image) : p.compile()) : null;
      const r = k.check({
        fn: opts.fn,
        count: opts.count,
        seed: opts.seed,
        ...(img
          ? {
              against: (f: string, c: { args: readonly number[]; memory: Uint8Array }) =>
                runImage(img.artifact, f, c.args, c.memory, { limit: 2e5 }) as never,
            }
          : {}),
      });
      const out = { ...r, fns: r.fns.map(x => ({ ...x, against: img ? img.id : 'r0' })) };
      env.emit('check', { program: p.name, check: out });
      return out;
    },

    // ---- the backend ----
    compile(opts: Record<string, unknown> & { rev?: number | string } = {}) {
      const { rev, ...o } = opts;
      const img = p.compile(o, revNumber(rev, p.rev));
      env.emit('image', { program: p.name, image: img.id });
      return imageHandle(p, img, env, ctx);
    },
    asmDiff(
      a: number | string = 'r0',
      b?: number | string,
      opts: {
        fn?: string;
        optionsA?: Record<string, unknown>;
        optionsB?: Record<string, unknown>;
        cases?: number;
      } & Record<string, unknown> = {},
    ) {
      const { fn, optionsA, optionsB, cases = 12, ...common } = opts;
      const f = fname(fn);
      const A = p.compile({ ...common, ...(optionsA || {}) }, revNumber(a, p.rev)),
        B = p.compile({ ...common, ...(optionsB || {}) }, revNumber(b, p.rev));
      const d = diffImages(A.artifact, B.artifact, f);
      const cs = casesFrom(p.head, f, { count: cases, seed: 11, inputs: (k.inputs[f] ?? {}) as never });
      const sa = { steps: 0, runs: 0 },
        sb = { steps: 0, runs: 0 };
      for (const c of cs) {
        const ra = runImage(A.artifact, f, c.args, c.memory, { limit: 5e4 });
        if (ra.limit || ra.fault) continue;
        const rb = A === B ? ra : runImage(B.artifact, f, c.args, c.memory, { limit: 5e4 });
        if (rb.limit || rb.fault) continue;
        sa.steps += ra.steps;
        sa.runs++;
        sb.steps += rb.steps;
        sb.runs++;
      }
      const side = (I: ImageEnt, s: { steps: number }) => {
        const x = I.value.fns[f];
        return {
          image: I.id,
          rev: `r${I.rev}`,
          bytes: x.bytes,
          frame: x.frame,
          spills: x.spills,
          saved: x.saved,
          instructionsRun: s.steps,
        };
      };
      p.lastImage = B;
      return {
        kind: 'asmDiff',
        fn: f,
        a: side(A, sa),
        b: side(B, sb),
        aEntry: A.value.fns[f].entry,
        bEntry: B.value.fns[f].entry,
        cases: sa.runs,
        same: d.same,
        removed: d.removed,
        added: d.added,
        rows: d.rows.map(r => {
          const x = (r.b || r.a)!;
          return {
            op: r.op,
            a: r.a ? r.a.id : null,
            b: r.b ? r.b.id : null,
            aOffset: r.a?.offset ?? null,
            bOffset: r.b?.offset ?? null,
            text: x.sym,
            covers: x.covers.slice(-1)[0] || null,
          };
        }),
      };
    },
    image(id?: string) {
      const img = p.image(id);
      return img ? imageHandle(p, img, env, ctx) : null;
    },
    images() {
      return p.images.map(x => ({
        id: x.id,
        rev: `r${x.rev}`,
        bytes: x.value.bytes,
        status: p.imageStatus(x),
        options: x.options,
      }));
    },
    reference() {
      return null;
    },
    machine(fn?: string, opts: Record<string, unknown> = {}) {
      return machineCode(k.head, fname(fn), opts);
    },
    focus(id: string | null) {
      return env.focus(id, p, ctx);
    },
    _describe() {
      return P.describe();
    },
    _p: p,
    _key: `prog:${p.name}#${p.uid}`,
  };
  return guard('Program', P);
}

export function imageHandle(p: WbProgram, img: ImageEnt, env: HandleEnv, ctx: SyncContext | null): any {
  const v = img.value;
  const I = {
    get id() {
      return img.id;
    },
    get rev() {
      return `r${img.rev}`;
    },
    get bytes() {
      return v.bytes;
    },
    get status() {
      return p.imageStatus(img);
    },
    get options() {
      return { ...backendDefaults, ...img.options };
    },
    get fns() {
      return JSON.parse(JSON.stringify(v.fns));
    },
    get ms() {
      return img.ms;
    },
    insns(fn?: string) {
      return v.insns
        .filter(e => !fn || e.fn === fn)
        .map(e => ({
          id: e.id,
          offset: e.offset,
          text: e.text,
          sym: e.sym,
          covers: e.covers,
          lines: p.k.lines(e.covers[0] || ''),
          ...(e.why ? { why: e.why } : {}),
        }));
    },
    listing(fn?: string) {
      return v.insns
        .filter(e => !fn || e.fn === fn)
        .map(e => {
          const lines = p.k.lines(e.covers[0] || '');
          return `${('0x' + e.offset.toString(16)).padStart(6)}  ${e.text.padEnd(24)} ${e.covers.slice(-1)[0] || ''}${lines.length ? ' line ' + lines.join(',') : ''}${e.why ? '  (' + e.why + ')' : ''}`;
        })
        .join('\n');
    },
    run(fn?: string, args: readonly unknown[] | Record<string, unknown> = [], opts: { limit?: number } = {}) {
      return env.programHandle(p, ctx).exec(fn, args, { ...opts, engine: 'rv32', image: img.id });
    },
    check(opts: Record<string, unknown> = {}) {
      return env.programHandle(p, ctx).check({ ...opts, against: 'image', image: img.id });
    },
    heat(fn?: string, args: readonly unknown[] = []) {
      const f = p.fname(fn);
      const c = benchOf(p.head, f, Array.isArray(args) ? args : []);
      const r = runImage(img.artifact, f, c.args, c.memory, { limit: 5e6 });
      const h = heatOf(img.store, img.artifact, r.counts);
      return {
        steps: r.steps,
        result: r.result,
        trap: r.trap,
        byLine: Object.fromEntries([...h.byLine].sort((a, b) => a[0] - b[0])),
        hottest: h.byInsn
          .filter(x => x.n)
          .slice()
          .sort((a, b) => b.n - a.n)
          .slice(0, 8)
          .map(x => ({ insn: x.id, text: img.byId.get(x.id)!.text, n: x.n })),
        _counts: r.counts ? Array.from(r.counts) : null,
      };
    },
    _describe() {
      return {
        id: img.id,
        rev: `r${img.rev}`,
        status: p.imageStatus(img),
        bytes: v.bytes,
        fns: v.fns,
        options: img.options,
      };
    },
    _img: img,
    _key: `img:${p.uid}:${img.id}`,
  };
  return guard('Image', I);
}

export { Program };
