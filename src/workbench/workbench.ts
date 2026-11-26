/**
 * The workbench root, `wb`, for the UI, project scripts, the console and the agent: a port of Compiler
 * Workbench's api.js on top of the kernel's `createWorkbench()` (src/typed/program.ts). It adds projects with
 * browser-local edits, parameters, compiled images, focus and events, the book, the reference (`wb.help`), the
 * workbench's own source, user passes and analyses, and fragments.
 *
 * `createWb(config)` returns the free root (async kernel calls return Promises). `wb.sync(fn)` runs prototype-
 * style synchronous code against it: `fn` gets a root bound to a SyncContext, on which they are synchronous.
 * Scripts, UI scripts, the console and the agent all run this way.
 */
import { dataflow } from '../framework/dataflow/analysis.js';
import { intervalLattice, mapLattice, setLattice } from '../framework/dataflow/lattices.js';
import { plan as planOf } from '../framework/strategy/builders.js';
import type { StrategyNode, StrategyPlan } from '../framework/strategy/ir.js';
import { ANALYSES, flowGraph } from '../typed/analyses.js';
import { BuilderError, passBuilder as kernelPassBuilder, USER_PASSES } from '../typed/builder.js';
import { hash } from '../typed/evaluate.js';
import { backendDefaults, backendExtras, backendOptionsAbout } from '../typed/backend/index.js';
import { blocksAdapter, BlocksIR, storeOf } from '../typed/ir.js';
import { describeText, lineage as lineageOf, linesOf, listing as listingOf } from '../typed/listing.js';
import type { Store, WorkFn } from '../typed/model.js';
import { PASSES, PIPELINES, type TypedPass } from '../typed/passes.js';
import { formatJson, joinText } from '../typed/format.js';
import {
  choosePlan,
  fromJson,
  passesNode,
  planFromSpec,
  PRESETS,
  toJson,
  untilStablePlan,
  type StrategySpec,
} from '../typed/strategies.js';
import { createWorkbench, Program } from '../typed/program.js';
import { didYouMean, ERRORS, fail, guard, toYaml } from './base.js';
import { fragments, handle, type EntityHost } from './entities.js';
import { FACTS, makeProgramHandle, WbProgram, type HandleEnv } from './programs.js';
import { makeProjects, type BuiltinProject, type ProjectState, type Storage } from './projects.js';
import { runSync, type SyncContext, type SyncOptions } from './sync.js';

export interface Chapter {
  readonly id: string;
  readonly title: string;
  readonly part?: string;
  readonly projects?: readonly string[];
  readonly md: string;
}
export interface WbConfig {
  readonly storage?: Storage | null;
  readonly projects?: readonly BuiltinProject[];
  readonly book?: readonly Chapter[];
  /** The API reference (Markdown); `wb.help(topic)` prints one `##` section. */
  readonly reference?: string;
  /** The workbench's own source, path -> text, for `wb.source` and the Code view. */
  readonly sources?: Readonly<Record<string, string>>;
}

/** Handles over a working store (a pass's), for user pass bodies and user analyses. */
function storeHost(st: Store): EntityHost {
  const get = (id: string) => st.get(id);
  return {
    id: `prog:${st.program}`,
    rev: st.rev,
    get head() {
      return st;
    },
    find: id => (st.has(id) ? { entity: st.get(id), store: st, rev: st.rev } : undefined),
    statusOf: id => (st.has(id) ? 'live' : 'absent'),
    text: id => describeText(st, id),
    lineage: id => lineageOf(get, id),
    lines: id => linesOf(get, id),
    why: id => ({ id, text: describeText(st, id) }),
    history: () => [],
    fact: (name, fn) => {
      const a = FACTS.get(name);
      if (!a || ['liveness', 'reaching', 'ranges'].includes(name) || a.user)
        fail('unknownAnalysis', `inside a pass, "${name}" comes through .needs({ alias: '${name}' })`);
      const value = a!.compute(null as never, st, st.fn(fn!));
      return { id: `fact:${name}(${fn})`, status: 'fresh', rev: `r${st.rev}`, ms: 0, value };
    },
    listing: fn => listingOf(st, fn),
    related: () => ({ lines: [], values: [], stmts: [], insns: [] }),
  } as EntityHost;
}

export function createWb(config: WbConfig = {}) {
  const kernel = createWorkbench();
  const listeners = new Map<string, Set<(...a: any[]) => void>>();
  const state: ProjectState & { logs: string[] } = {
    programs: new Map(),
    current: null,
    projectId: null,
    focus: null,
    paramDefs: new Map(),
    paramValues: {},
    logs: [],
  };
  const emit = (event: string, data?: unknown) => {
    for (const fn of listeners.get(event) || [])
      try {
        fn(data);
      } catch (e) {
        console.error(e);
      }
    for (const fn of listeners.get('*') || [])
      try {
        fn(event, data);
      } catch (e) {
        console.error(e);
      }
  };
  const writes = (what: string, ctx: SyncContext | null, p?: WbProgram) => {
    if (ctx && ctx.readOnly && !(p && p.scratch))
      fail('readOnly', `read-only mode: ${what}() is off`, {
        fix: 'change programs in a button handler or a task, or switch the agent to Ask or Auto',
      });
  };

  // ---------- user passes (the kernel's builder) and analyses ----------
  /** Each user pass's body (for replay keys) and the script that defined it (for the Compiler view). */
  const userInfo = new WeakMap<
    TypedPass,
    { body: string; definedIn: string | null; project: string | null }
  >();
  const passNames = () => [...Object.keys(PASSES), ...USER_PASSES.keys()];
  const resolvePass = (x: unknown): TypedPass => {
    if (typeof x === 'string') {
      const p = PASSES[x] ?? USER_PASSES.get(x);
      if (!p) {
        const near = didYouMean(x, passNames());
        fail('unknownPass', `no pass named "${x}".` + (near ? ` Did you mean "${near}"?` : ''), {
          fix: `passes: ${passNames().join(', ')}`,
        });
      }
      return p!;
    }
    if (x && typeof x === 'object' && (x as { _pass?: TypedPass })._pass)
      return (x as { _pass: TypedPass })._pass;
    if (x && typeof x === 'object' && (x as TypedPass).typed) return x as TypedPass;
    return fail('notAPass', 'expected a pass name or a pass made with wb.pass(name)…run(fn)');
  };
  const passKey = (pass: TypedPass) => {
    const u = userInfo.get(pass);
    return u ? `${pass.typed.name}#${hash(u.body)}` : pass.typed.name;
  };
  /** The kernel builder's refusals as workbench errors (a code and a fix line). */
  const builderCall = <T>(f: () => T): T => {
    try {
      return f();
    } catch (e) {
      if (e instanceof BuilderError)
        fail(e.code, e.message.replace(/^\[\w+\] /, '').split('\n')[0], e.fix ? { fix: e.fix } : {});
      throw e;
    }
  };
  function passBuilder(name: string, ctx: SyncContext | null) {
    const b = builderCall(() => kernelPassBuilder(name));
    const spec = {
      about: '',
      needs: {} as Record<string, string>,
      writes: [] as string[],
      preserves: [] as string[],
    };
    const w: any = guard('PassBuilder', {
      about(t: string) {
        spec.about = String(t);
        b.about(spec.about);
        return w;
      },
      needs(m: Record<string, string | { name: string }>) {
        const names = Object.fromEntries(
          Object.entries(m || {}).map(([k, v]) => [k, typeof v === 'string' ? v : v && v.name]),
        );
        builderCall(() => b.needs(names));
        Object.assign(spec.needs, names);
        return w;
      },
      writes(...k: string[]) {
        builderCall(() => b.writes(...k));
        spec.writes = k;
        return w;
      },
      preserves(...a: string[]) {
        builderCall(() => b.preserves(...a));
        spec.preserves = a;
        return w;
      },
      run(fn: (fnHandle: any, tx: any, facts: any, params: any) => void) {
        if (typeof fn !== 'function')
          fail('badArgument', 'run(fn): fn is (fn, tx, facts, params) => …', {
            fix: '.run((fn, tx) => { tx.rewrite(v => …) })',
          });
        const before = USER_PASSES.get(name);
        const pass = builderCall(() => b.run(fn));
        const m = ctx && /^([^/]+)\/(scripts\/.+\.js|ui\/.+\.js)$/.exec(ctx.label);
        userInfo.set(pass, {
          body: String(fn),
          definedIn: m ? m[2] : ctx ? ctx.label : null,
          project: m ? m[1] : null,
        });
        // a script that defines a pass runs once per replay: tell the views only when the pass is new or changed
        if (!before || userInfo.get(before)?.body !== String(fn)) emit('passes', { name, user: true });
        return guard('Pass', {
          name,
          id: pass.id,
          version: pass.version,
          about: spec.about,
          writes: spec.writes,
          needs: spec.needs,
          preserves: spec.preserves,
          _pass: pass,
          _key: `pass:${passKey(pass)}`,
        });
      },
    });
    return w;
  }
  const lattice = guard('Lattices', {
    set: () => setLattice(),
    map: (inner: any) => mapLattice(inner),
    interval: () => intervalLattice(),
  });
  function analysisBuilder(name: string) {
    const spec: {
      direction: 'forward' | 'backward';
      lattice: any;
      transfer: any;
      entry: any;
      about: string;
      widen: any;
    } = {
      direction: 'forward',
      lattice: null,
      transfer: null,
      entry: null,
      about: '',
      widen: null,
    };
    const b: any = guard('AnalysisBuilder', {
      direction(d: 'forward' | 'backward') {
        if (!['forward', 'backward'].includes(d))
          fail('badArgument', `direction is 'forward' or 'backward', not ${d}`);
        spec.direction = d;
        return b;
      },
      forward() {
        spec.direction = 'forward';
        return b;
      },
      backward() {
        spec.direction = 'backward';
        return b;
      },
      lattice(L: any) {
        spec.lattice = L;
        return b;
      },
      transfer(fn: any) {
        spec.transfer = fn;
        return b;
      },
      entry(fn: any) {
        spec.entry = fn;
        return b;
      },
      widen(fn: any) {
        spec.widen = fn;
        return b;
      },
      reads() {
        return b;
      },
      about(text: string) {
        spec.about = text;
        return b;
      },
      register() {
        if (!spec.lattice)
          fail('incomplete', `analysis "${name}" has no .lattice(…)`, { fix: '.lattice(wb.lattice.set())' });
        if (!spec.transfer) fail('incomplete', `analysis "${name}" has no .transfer(…)`);
        if (typeof spec.lattice.encode !== 'function')
          fail('badArgument', `analysis "${name}": the lattice comes from wb.lattice (set, map, interval)`);
        if (spec.lattice.infiniteHeight && !spec.widen && !spec.lattice.widen)
          fail('noWidening', `analysis "${name}": lattice "${spec.lattice.name}" has infinite height`, {
            fix: 'add .widen((old, next) => …)',
          });
        const a = dataflow<any, any, { st: Store; f: WorkFn }>({
          id: `user.${name}`,
          version: String(Date.now()),
          description: spec.about || `user analysis (${spec.direction})`,
          input: BlocksIR,
          adapter: blocksAdapter,
          direction: spec.direction,
          lattice: spec.lattice,
          strategy: 'round-robin',
          regions: (view: any) => {
            const st = storeOf(view.artifact.value);
            return [...st.fns.values()].map(f => ({ id: f.name, graph: flowGraph(f), context: { st, f } }));
          },
          transfer: (block, v, { st }) => spec.transfer(handle(storeHost(st) as never, block), v),
          ...(spec.entry
            ? {
                boundary: (_r: unknown, { st, f }: { st: Store; f: WorkFn }) =>
                  spec.entry(handle(storeHost(st) as never, f.id)),
              }
            : {}),
          ...(spec.widen || spec.lattice.widen
            ? { widen: (x: unknown, y: unknown) => (spec.widen || spec.lattice.widen)(x, y) }
            : {}),
          reads: {
            entities: ['block', 'stmt.*', 'value.*', 'local'],
            relations: ['contains', 'succ', 'jump', 'uses', 'operand', 'reads', 'writes', 'declares'],
          },
        });
        FACTS.set(name, {
          about: spec.about || `user analysis (${spec.direction})`,
          user: true,
          compute: (art, _st, f) => {
            const s = a.decode(a.solveArtifact(art), f.name);
            return { in: s.in, out: s.out, visits: s.iterations, rounds: s.rounds };
          },
        });
        return { registered: name, direction: spec.direction, lattice: spec.lattice.name };
      },
    });
    return b;
  }
  function pipelineBuilder(name: string) {
    const steps: string[] = [];
    let checkEach = true;
    const b: any = guard('PipelineBuilder', {
      pipe(x: unknown) {
        steps.push(resolvePass(x).typed.name);
        return b;
      },
      checkEach(on = true) {
        checkEach = !!on;
        return b;
      },
      build() {
        return guard('Plan', {
          name,
          passes: steps.slice(),
          checkEach,
          explain: () =>
            [`pipeline ${name} · ${steps.length} passes` + (checkEach ? ' · checked after each pass' : '')]
              .concat(steps.map(s => `  ${s}`))
              .join('\n'),
        });
      },
    });
    return b;
  }

  // ---------- handles per context ----------
  const free = new WeakMap<WbProgram, any>();
  const bound = new WeakMap<SyncContext, { api: any; progs: WeakMap<WbProgram, any> }>();
  const programHandle = (p: WbProgram, ctx: SyncContext | null): any => {
    if (!ctx || ctx.closed) {
      let h = free.get(p);
      if (!h) free.set(p, (h = makeProgramHandle(p, henv, null)));
      return h;
    }
    const b = binding(ctx);
    let h = b.progs.get(p);
    if (!h) b.progs.set(p, (h = makeProgramHandle(p, henv, ctx)));
    return h;
  };
  const focus = (id: string | null, p: WbProgram | null) => {
    const q = p ?? state.current;
    if (id && q && !q.has(id)) fail('absent', `${id} does not exist in ${q.id}`);
    state.focus = id || null;
    const related = id && q ? q.related(id) : null;
    emit('focus', { id, related });
    return id && q ? { focus: id, text: q.text(id), ...related } : { focus: null };
  };
  const henv: HandleEnv = {
    emit,
    writes,
    focus: (id, p) => focus(id, p),
    resolvePass,
    passKey,
    strategyPlan: (x, p) => strategyPlan(x, p.project),
    programHandle,
    replace(p, source) {
      const k = new Program(p.name, source, { inputs: p.k.inputs });
      const q = new WbProgram(k);
      state.programs.set(p.name, q);
      if (state.current === p) state.current = q;
      emit('program', { program: q.name, why: 'edit' });
      return q;
    },
  };

  // ---------- state snapshots (replays, the agent's revert) ----------
  const snapshot = () => ({
    current: state.current,
    projectId: state.projectId,
    focus: state.focus,
    programs: [...state.programs].map(([n, q]) => [n, q, q.chain.slice()] as const),
    files: projects.snapshot(),
  });
  const restore = (s: ReturnType<typeof snapshot>) => {
    state.programs = new Map(
      s.programs.map(([n, q, chain]) => {
        q.setChain(chain);
        return [n, q];
      }),
    );
    projects.restore(s.files);
    state.current = s.current;
    state.projectId = s.projectId;
    state.focus = s.focus;
  };
  const touchState = (ctx: SyncContext | null) => {
    if (ctx && !ctx.closed)
      ctx.touch(state, () => {
        const s = snapshot();
        return () => restore(s);
      });
  };

  const projects = makeProjects(
    { state, kernel, emit, writes, touchState, api: ctx => api(ctx) },
    config.projects ?? [],
    config.storage ?? null,
  );

  // ---------- parameters: sliders and toggles a script declares ----------
  const declare = (kind: string, name: string, opts: Record<string, unknown>) => {
    if (typeof name !== 'string' || !name) fail('badArgument', 'a parameter needs a name');
    const def: Record<string, any> = { name, kind, ...opts };
    state.paramDefs.set(name, def);
    emit('params', [...state.paramDefs.values()]);
    const v = state.paramValues[name];
    return v === undefined ? def.default : v;
  };
  const param = guard('Params', {
    int(name: string, { min = 0, max = 100, step = 1, default: d = min, about = '' }: any = {}) {
      return (declare('int', name, { min, max, step, default: d, about }) as number) | 0;
    },
    float(name: string, { min = 0, max = 1, step = 0.01, default: d = min, about = '' }: any = {}) {
      return +(declare('float', name, { min, max, step, default: d, about }) as number);
    },
    bool(name: string, { default: d = false, about = '' }: any = {}) {
      return !!declare('bool', name, { default: d, about });
    },
    choice(name: string, options: unknown[], { default: d = options[0], about = '' }: any = {}) {
      const v = declare('choice', name, { options, default: d, about });
      return options.includes(v) ? v : d;
    },
    list() {
      return [...state.paramDefs.values()].map((d: any) => ({
        ...d,
        value: state.paramValues[d.name] ?? d.default,
      }));
    },
    set(name: string, value: unknown) {
      state.paramValues[name] = value;
      emit('paramValue', { name, value });
      return { [name]: value };
    },
    reset() {
      state.paramValues = {};
      emit('params', [...state.paramDefs.values()]);
      return 'reset';
    },
  });

  // ---------- the book, the reference and the workbench's own source ----------
  const BOOK = config.book ?? [];
  const book: any = guard('Book', {
    contents() {
      return BOOK.map((c, i) => ({
        id: c.id,
        n: i + 1,
        title: c.title,
        part: c.part,
        sections: (c.md.match(/^## .*/gm) || []).map(s => s.slice(3)),
      }));
    },
    read(id: string, section?: string) {
      const c = BOOK.find(x => x.id === id || x.title === id);
      if (!c) {
        const near = didYouMean(
          id,
          BOOK.map(x => x.id),
        );
        fail('unknownChapter', `no chapter "${id}".` + (near ? ` Did you mean "${near}"?` : ''), {
          fix: 'wb.book.contents() lists them',
        });
      }
      if (!section) return c!.md;
      const parts = c!.md.split(/^(?=## )/m),
        hit = parts
          .slice(1)
          .find(s => s.split('\n')[0].toLowerCase().includes(String(section).toLowerCase()));
      if (!hit)
        fail('unknownSection', `chapter "${id}" has no section "${section}"`, {
          fix: `sections: ${parts
            .slice(1)
            .map(s => s.split('\n')[0].slice(3))
            .join(' | ')}`,
        });
      return hit!;
    },
    search(text: string, { limit = 20 } = {}) {
      const q = String(text).toLowerCase(),
        out: { chapter: string; line: number; text: string }[] = [];
      for (const c of BOOK)
        c.md.split('\n').forEach((l, i) => {
          if (out.length < limit && l.toLowerCase().includes(q))
            out.push({ chapter: c.id, line: i + 1, text: l.trim().slice(0, 160) });
        });
      return out;
    },
    open(id: string, section?: string) {
      book.read(id, section || undefined);
      emit('view', { view: 'book', chapter: id, section });
      return { opened: id };
    },
  });
  const REFERENCE = config.reference ?? '';
  const help = (topic?: string) => {
    if (!topic)
      return (
        REFERENCE.split('\n')
          .filter(l => /^#{2,3} /.test(l))
          .map(l => l.replace(/^#+ /, ''))
          .join('\n') + '\n\nwb.help(topic) prints one section; a topic is any word of\nthe headings above.'
      );
    const parts = REFERENCE.split(/^(?=## )/m);
    const hit = parts.find(s => s.split('\n')[0].toLowerCase().includes(String(topic).toLowerCase()));
    return hit || `no section about "${topic}"; wb.help() lists them`;
  };
  const SOURCES = config.sources ?? {};
  const findSource = (path: string) =>
    SOURCES[path] ??
    SOURCES[Object.keys(SOURCES).find(k => k.endsWith('/' + path) || k.endsWith(path)) || ''];
  const source: any = guard('Source', {
    files() {
      return Object.keys(SOURCES).map(path => ({
        path,
        lines: SOURCES[path].split('\n').length,
        bytes: SOURCES[path].length,
        about: (SOURCES[path].match(/^\s*(?:\/\/|\*|\/\*\*) ?(.*\S.*)$/m) || ['', ''])[1].slice(0, 140),
      }));
    },
    read(path: string, from = 1, to?: number) {
      const text = findSource(path);
      if (text === undefined) {
        const near = didYouMean(path, Object.keys(SOURCES));
        fail('unknownFile', `no source file "${path}".` + (near ? ` Did you mean "${near}"?` : ''), {
          fix: 'wb.source.files() lists them',
        });
      }
      const lines = text.split('\n'),
        end = Math.min(lines.length, to ?? from + 199);
      return (
        lines
          .slice(from - 1, end)
          .map((l, i) => `${String(from + i).padStart(5)}  ${l}`)
          .join('\n') +
        (end < lines.length
          ? `\n… ${lines.length - end} more lines: wb.source.read('${path}', ${end + 1})`
          : '')
      );
    },
    grep(pattern: string | RegExp, { path = '', limit = 60, context = 0 } = {}) {
      const re =
        pattern instanceof RegExp
          ? pattern
          : new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const out: { file: string; line: number; text: string }[] = [];
      for (const [file, text] of Object.entries(SOURCES)) {
        if (path && !file.includes(path)) continue;
        const lines = text.split('\n');
        lines.forEach((l, i) => {
          if (out.length < limit && re.test(l))
            out.push(
              context
                ? {
                    file,
                    line: i + 1,
                    text: lines.slice(Math.max(0, i - context), i + context + 1).join('\n'),
                  }
                : { file, line: i + 1, text: l.trim().slice(0, 200) },
            );
        });
      }
      return out;
    },
    outline(path: string) {
      const text = findSource(path);
      if (text === undefined)
        fail('unknownFile', `no source file "${path}"`, { fix: 'wb.source.files() lists them' });
      const out: string[] = [];
      text.split('\n').forEach((l, i) => {
        const m =
          /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)\s*=|interface\s+(\w+))/.exec(
            l,
          );
        if (m) out.push(`${String(i + 1).padStart(5)}  ${m[1] || m[2] || m[3] || m[4]}`);
      });
      return out.join('\n');
    },
    /** Where a pass or an analysis of the compiler is defined, with its text. */
    definition(name: string) {
      const d = definition(name);
      if (!d)
        fail('unknownPass', `no built-in pass or analysis "${name}" in the sources`, {
          fix: `passes: ${Object.keys(PASSES).join(', ')}; analyses: ${Object.keys(ANALYSES).join(', ')}`,
        });
      return d;
    },
    find(name: string) {
      return source.grep(
        new RegExp(`(function ${name}\\b|class ${name}\\b|const ${name}\\s*=|${name}\\s*\\(.*\\)\\s*[:{])`),
      );
    },
  });

  // ---------- where the compiler's parts are defined (for the Compiler view and wb.source.definition) ----------
  /** The top-level declaration around `line` (0-based), with the comment above it. */
  const chunk = (lines: string[], line: number) => {
    const top = /^(export |const |let |function |async function |class |interface |type )/;
    let a = line;
    while (a > 0 && !top.test(lines[a])) a--;
    while (a > 0 && /^(\s*\*|\/\*\*|\/\/)/.test(lines[a - 1])) a--;
    let b = line + 1;
    while (b < lines.length && !top.test(lines[b]) && !/^\/\*\*|^\/\/ -/.test(lines[b])) b++;
    while (b > line + 1 && lines[b - 1].trim() === '') b--;
    return { from: a + 1, to: b };
  };
  const definition = (what: string) => {
    const name = String(what)
      .replace(/^typed\./, '')
      .replace(/@.*$/, '');
    const esc = name.replace(/[-.]/g, m => '\\' + m);
    const anchors = [new RegExp(`^\\s*name: '${esc}',`), new RegExp(`^\\s*id: 'typed\\.${esc}',`)];
    for (const re of anchors)
      for (const [path, text] of Object.entries(SOURCES)) {
        if (!/^src\/typed\/[^/]+\.ts$/.test(path)) continue;
        const lines = text.split('\n');
        const i = lines.findIndex(l => re.test(l));
        if (i >= 0) {
          const { from, to } = chunk(lines, i);
          return { path, line: i + 1, from, to, text: lines.slice(from - 1, to).join('\n') };
        }
      }
    return null;
  };

  // ---------- strategies: plans over the passes, per project ----------
  const METRICS = ['instructions', 'bytes', 'statements', 'blocks'] as const;
  const pipelinePlan = (name: string) =>
    planOf(`typed.pipeline.${name}`, passesNode(name, name), `the ${name} pipeline as a plan`);
  interface StrategyEntry {
    name: string;
    kind: 'project' | 'preset' | 'pipeline';
    path?: string;
    id?: string;
    about?: string;
    /** The short form it was written in (a project file or a preset), if it was. */
    spec?: StrategySpec;
    plan?: StrategyPlan;
    error?: string;
  }
  /** A strategy file's text: the short form ({ passes } | { choose, by } | { repeat }) or a full plan. */
  const parseStrategy = (name: string, text: string): { plan: StrategyPlan; spec?: StrategySpec } => {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && value.formatVersion !== undefined)
      return { plan: fromJson(text) };
    return { plan: planFromSpec(name, value), spec: value };
  };
  const strategyList = (projectId: string | null = state.projectId): StrategyEntry[] => {
    const out: StrategyEntry[] = [];
    if (projectId && projects.exists(projectId))
      for (const [path, text] of Object.entries(projects.filesOf(projectId))) {
        const m = /^strategies\/([^/]+)\.json$/.exec(path);
        if (!m) continue;
        try {
          const { plan, spec } = parseStrategy(m[1], text);
          const about = spec ? joinText(spec.about) : plan.description;
          out.push({ name: m[1], kind: 'project', path, id: plan.id, about, spec, plan });
        } catch (e) {
          out.push({
            name: m[1],
            kind: 'project',
            path,
            error: String((e as Error).message || e).split('\n')[0],
          });
        }
      }
    for (const [n, spec] of Object.entries(PRESETS))
      out.push({
        name: n,
        kind: 'preset',
        id: `typed.strategy.${n}`,
        about: joinText(spec.about),
        spec,
        plan: planFromSpec(n, spec),
      });
    for (const n of Object.keys(PIPELINES)) {
      const plan = pipelinePlan(n);
      out.push({
        name: n,
        kind: 'pipeline',
        id: plan.id,
        about: plan.description,
        spec: { passes: n },
        plan,
      });
    }
    return out;
  };
  const isPlan = (x: unknown): x is StrategyPlan =>
    !!x && typeof x === 'object' && (x as StrategyPlan).formatVersion === 1 && !!(x as StrategyPlan).root;
  function strategyPlan(
    x: unknown,
    projectId: string | null = state.projectId,
    name = 'adhoc',
  ): StrategyPlan {
    if (typeof x === 'string') {
      const t = x.trim();
      if (t.startsWith('{')) {
        try {
          return parseStrategy(name, t).plan;
        } catch (e) {
          return fail(
            'badStrategy',
            `the strategy JSON does not parse: ${String((e as Error).message).split('\n')[0]}`,
            { fix: 'wb.strategy.toJson(wb.strategy.choose(…)) shows the format' },
          );
        }
      }
      const list = strategyList(projectId);
      // a project's own strategy first, then a preset, then a pipeline of the same name
      const hit = list.find(e => e.name === t || e.id === t || e.path === t);
      if (!hit) {
        const near = didYouMean(
          t,
          list.map(e => e.name),
        );
        fail('unknownStrategy', `no strategy "${t}".` + (near ? ` Did you mean "${near}"?` : ''), {
          fix: `strategies: ${list.map(e => e.name).join(', ')}`,
        });
      }
      if (hit!.error)
        fail('badStrategy', `${hit!.path}: ${hit!.error}`, { fix: 'fix the JSON in the Strategies view' });
      return hit!.plan!;
    }
    const o = x && typeof x === 'object' ? ((x as { _plan?: unknown })._plan ?? x) : x;
    if (isPlan(o)) return o;
    if (o && typeof o === 'object' && ['passes', 'choose', 'repeat'].some(k => k in (o as object)))
      try {
        return planFromSpec(name, o as StrategySpec);
      } catch (e) {
        return fail('badStrategy', String((e as Error).message).split('\n')[0], {
          fix: '{ "passes": "O2" } | { "choose": { … }, "by": "instructions" } | { "repeat": [ … ], "max": 8 }',
        });
      }
    return fail('badArgument', 'a strategy is a plan (wb.strategy.choose(…)), its JSON, or a name', {
      fix: "wb.strategy.list() names them; wb.strategy.choose('fast', { a: 'O1', b: 'O2' }, 'instructions')",
    });
  }
  const candidate = (x: unknown, what: string): string | string[] => {
    if (typeof x === 'string') {
      if (PIPELINES[x]) return x;
      if (PASSES[x] || USER_PASSES.has(x)) return [x];
      const names = [...Object.keys(PIPELINES), ...passNames()];
      const near = didYouMean(x, names);
      return fail(
        'unknownPipeline',
        `${what}: no pipeline or pass "${x}".` + (near ? ` Did you mean "${near}"?` : ''),
        { fix: `pipelines: ${Object.keys(PIPELINES).join(', ')}; or a list of pass names` },
      );
    }
    if (Array.isArray(x)) {
      for (const n of x) resolvePass(n);
      return x.map(String);
    }
    return fail('badArgument', `${what}: a pipeline name or a list of pass names`);
  };
  /** A plan as indented lines: what runs, in what shape. */
  const explainPlan = (pl: StrategyPlan) => {
    const out = [`${pl.id}${pl.description ? ' · ' + pl.description : ''}`];
    const walk = (n: StrategyNode, depth: number, label = '') => {
      const pad = '  '.repeat(depth) + label;
      const k = n as any;
      switch (n.kind) {
        case 'apply':
          out.push(`${pad}apply ${k.algorithm.id}@${k.algorithm.version}`);
          return;
        case 'sequence':
        case 'parallel':
          if (k.steps.every((x: StrategyNode) => x.kind === 'apply'))
            out.push(
              `${pad}${n.kind}: ${k.steps.map((x: any) => x.algorithm.id.replace(/^typed\./, '')).join(' → ')}`,
            );
          else {
            out.push(`${pad}${n.kind}`);
            k.steps.forEach((x: StrategyNode) => walk(x, depth + 1));
          }
          return;
        case 'fork':
          out.push(`${pad}fork (${k.branches.length} candidates)`);
          k.branches.forEach((b: { name: string; strategy: StrategyNode }) =>
            walk(b.strategy, depth + 1, `${b.name}: `),
          );
          return;
        case 'chooseBest':
          out.push(
            `${pad}choose the ${k.objective.direction === 'max' ? 'largest' : 'smallest'} ${k.objective.metric}` +
              (k.constraints.length
                ? ` where ${k.constraints.map((c: any) => `${c.metric} ${c.op} ${c.value}`).join(', ')}`
                : '') +
              (k.metrics ? ` (measured by ${k.metrics.id}@${k.metrics.version})` : ''),
          );
          walk(k.candidates, depth + 1);
          return;
        case 'repeatUntilStable':
          out.push(`${pad}repeat until stable (at most ${k.maxIterations} times)`);
          walk(k.body, depth + 1);
          return;
        default:
          out.push(`${pad}${n.kind} ${n.id}`);
          for (const c of ['body', 'then', 'else', 'fallback'] as const)
            if (k[c]) walk(k[c], depth + 1, `${c}: `);
      }
    };
    walk(pl.root, 1);
    return out.join('\n');
  };

  // ---------- the compiler, as data ----------
  const ref = (d: { id: string; version: string } | undefined) => (d ? `${d.id}@${d.version}` : '?');
  const passRow = (x: TypedPass) => {
    const u = userInfo.get(x);
    const user = !PASSES[x.typed.name];
    const def = user ? null : definition(x.typed.name);
    return {
      name: x.typed.name,
      id: x.id,
      version: x.version,
      about: x.typed.about,
      kind: user ? 'user' : 'builtin',
      needs: Object.fromEntries(Object.entries(x.needs ?? {}).map(([alias, d]) => [alias, ref(d as never)])),
      writes: x.typed.writes,
      entities: x.writes.entities,
      relations: x.writes.relations,
      preserves: (x.preserves ?? []).map(d => ref(d as never)),
      ...(def ? { source: `${def.path}:${def.line}` } : {}),
      ...(u ? { definedIn: u.definedIn, project: u.project, body: u.body } : {}),
    };
  };
  const compiler = () => ({
    passes: Object.values(PASSES).map(passRow),
    userPasses: [...USER_PASSES.values()].map(passRow),
    analyses: [
      ...Object.entries(ANALYSES).map(([name, a]) => {
        const def = definition(a.id);
        return {
          name,
          id: a.id,
          version: a.version,
          about: a.description,
          kind: 'builtin',
          ...(def ? { source: `${def.path}:${def.line}` } : {}),
        };
      }),
      ...[...FACTS]
        .filter(([, a]) => a.user)
        .map(([name, a]) => ({ name, id: `user.${name}`, version: '1', about: a.about, kind: 'user' })),
    ],
    pipelines: Object.fromEntries(Object.entries(PIPELINES).map(([k, v]) => [k, [...v]])),
    strategies: strategyList().map(({ plan: _plan, ...e }) => e),
    metrics: { id: 'typed.metrics@1', measures: [...METRICS] },
    contract: 'every pass is gated by the meaning contract against r0 (typed.meaning-kept, 40 cases)',
  });

  /** wb.strategy: plans to build, read, save and run. */
  function strategyApi(ctx: SyncContext | null) {
    return guard('Strategy', {
      metrics: METRICS,
      choose(
        name: string,
        candidates: Record<string, unknown>,
        objective: string | { metric: string; direction?: 'min' | 'max' } = 'instructions',
        constraints: readonly { metric: string; op: string; value: number }[] = [],
      ) {
        if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name))
          fail('badArgument', 'choose(name, …): a name of letters, digits, _ . -', {
            fix: "wb.strategy.choose('fast', { O1: 'O1', O2: 'O2' }, 'instructions')",
          });
        if (!candidates || typeof candidates !== 'object' || !Object.keys(candidates).length)
          fail('badArgument', 'choose(name, candidates): candidates is { name: pipeline or [passes] }', {
            fix: "{ O1: 'O1', O2: 'O2', mine: ['add-self', 'fold'] }",
          });
        const obj = typeof objective === 'string' ? { metric: objective } : objective;
        if (!METRICS.includes(obj.metric as never)) {
          const near = didYouMean(obj.metric, [...METRICS]);
          fail('badArgument', `no metric "${obj.metric}".` + (near ? ` Did you mean "${near}"?` : ''), {
            fix: `metrics: ${METRICS.join(', ')}`,
          });
        }
        for (const c of constraints)
          if (!['<=', '>=', '<', '>', '=='].includes(c.op) || typeof c.value !== 'number')
            fail(
              'badArgument',
              `constraint ${JSON.stringify(c)}: { metric, op: <= >= < > ==, value: number }`,
            );
        const cands = Object.fromEntries(
          Object.entries(candidates).map(([k, v]) => [k, candidate(v, `candidate ${k}`)]),
        );
        return choosePlan(name, cands, obj as never, constraints as never);
      },
      untilStable(name: string, passes: readonly string[], maxIterations = 8) {
        for (const n of passes || []) resolvePass(n);
        return untilStablePlan(name, passes, maxIterations);
      },
      pipeline(name: string) {
        candidate(name, 'pipeline');
        return pipelinePlan(name);
      },
      /** A plan as JSON at tile width (the full form). */
      toJson(plan: unknown) {
        return toJson(strategyPlan(plan));
      },
      /** A plan from JSON: the short form or a full plan. */
      fromJson(text: string, name = 'adhoc') {
        if (typeof text !== 'string' || !text.trim().startsWith('{'))
          fail('badArgument', 'fromJson(text): the JSON of a strategy (short form) or a plan');
        return strategyPlan(text, state.projectId, name);
      },
      /** The short form to a plan: { passes } | { choose, by, direction, constraints } | { repeat, max }. */
      fromSpec(name: string, spec: StrategySpec) {
        return strategyPlan(spec, state.projectId, name);
      },
      /** The built-in strategies, in the short form. */
      presets() {
        return JSON.parse(JSON.stringify(PRESETS));
      },
      list() {
        return strategyList().map(({ plan, ...e }) => ({ ...e, ...(plan ? { root: plan.root.kind } : {}) }));
      },
      get(name: string) {
        return strategyPlan(name);
      },
      explain(plan: unknown) {
        return explainPlan(strategyPlan(plan));
      },
      run(p: any, plan?: unknown) {
        const target = p && typeof p === 'object' && (p as { _p?: WbProgram })._p ? p : null;
        const h = target ?? (state.current ? programHandle(state.current, ctx) : null);
        if (!h) fail('noProgram', 'no program open', { fix: "wb.projects.open('blend')" });
        return h.strategy(target ? plan : p);
      },
      save(name: string, plan: unknown) {
        writes('strategy.save', ctx);
        const pr = state.projectId;
        if (!pr) fail('noProject', 'no project open', { fix: "wb.projects.open('blend')" });
        if (typeof name !== 'string' || !/^[A-Za-z0-9_-]+$/.test(name))
          fail('badPath', `"${name}" is not a strategy name: letters, digits, _ -`);
        // the short form when given one (or its JSON), the full plan otherwise; either way at tile width
        let value: unknown = plan;
        if (typeof plan === 'string') {
          try {
            value = JSON.parse(plan);
          } catch (e) {
            fail('badStrategy', `the strategy JSON does not parse: ${(e as Error).message}`);
          }
        }
        const full = isPlan(value);
        const checked = strategyPlan(value, pr, name); // refuses what would not run
        const text = full ? toJson(checked) : formatJson(value);
        projects.make(ctx).get(pr!).files.write(`strategies/${name}.json`, text);
        return { saved: `strategies/${name}.json`, project: pr };
      },
    });
  }

  // ---------- the root, one per context ----------
  function binding(ctx: SyncContext) {
    let b = bound.get(ctx);
    if (!b) {
      b = { api: null, progs: new WeakMap() };
      bound.set(ctx, b);
      b.api = makeApi(ctx);
    }
    return b;
  }
  let freeApi: any = null;
  function api(ctx: SyncContext | null): any {
    if (!ctx || ctx.closed) return (freeApi ??= makeApi(null));
    return binding(ctx).api;
  }
  function makeApi(ctx: SyncContext | null): any {
    const projectsApi = projects.make(ctx);
    const root: any = {
      version: '2.0',
      program(name: string, src: string, opts: { inputs?: Record<string, unknown>; open?: boolean } = {}) {
        if (typeof name !== 'string' || typeof src !== 'string')
          fail('badArgument', 'wb.program(name, source): two strings', {
            fix: "wb.program('mine', 'function f(x: i32): i32 { return x + 1; }')",
          });
        touchState(ctx);
        const q = new WbProgram(kernel.program(name, src, { inputs: (opts.inputs ?? {}) as never }));
        state.programs.set(name, q);
        if (opts.open) {
          state.current = q;
          emit('program', { program: name, why: 'new' });
        }
        return programHandle(q, ctx);
      },
      open(x: string | { _p?: WbProgram }) {
        const q = typeof x === 'string' ? state.programs.get(x) : x && x._p;
        if (!q)
          fail('unknownProgram', `no program "${String(x)}"`, {
            fix: `programs: ${[...state.programs.keys()].join(', ')}`,
          });
        touchState(ctx);
        state.current = q!;
        emit('program', { program: q!.name, why: 'open' });
        return programHandle(q!, ctx);
      },
      get current() {
        return state.current ? programHandle(state.current, ctx) : null;
      },
      programs() {
        return [...state.programs.values()].map(q => ({
          name: q.name,
          status: q.k.status,
          rev: `r${q.rev}`,
          project: q.project,
          current: q === state.current,
        }));
      },
      projects: projectsApi,
      pipelines() {
        return Object.fromEntries(
          Object.entries(PIPELINES).map(([k, v]) => [k, v.join(' → ') || '(nothing: the lifted code as is)']),
        );
      },
      passes() {
        return [...Object.values(PASSES), ...USER_PASSES.values()].map(x => ({
          name: x.typed.name,
          about: x.typed.about,
          needs: Object.values(x.typed.needs ?? {}),
          writes: x.typed.writes,
          preserves: x.typed.preserves ?? [],
          ...(PASSES[x.typed.name] ? {} : { user: true }),
        }));
      },
      compiler,
      strategy: strategyApi(ctx),
      analyses() {
        return [...FACTS].map(([name, a]) => ({ name, about: a.about, ...(a.user ? { user: true } : {}) }));
      },
      pass(name: string) {
        writes('pass', ctx);
        return passBuilder(name, ctx);
      },
      analysis(name: string) {
        writes('analysis', ctx);
        return analysisBuilder(name);
      },
      pipeline(name: string) {
        return pipelineBuilder(name);
      },
      lattice,
      param,
      fragment(name: string) {
        writes('fragment', ctx);
        return fragments.define(name);
      },
      use(x: string) {
        writes('use', ctx);
        const n = fragments.use(x);
        emit('fragments', fragments.list());
        return { using: n };
      },
      drop(name: string) {
        fragments.drop(name);
        return { dropped: name };
      },
      fragments() {
        return fragments.list();
      },
      focus(id: string | null, p?: { _p?: WbProgram }) {
        return focus(id, p ? (p._p ?? null) : null);
      },
      get focused() {
        return state.focus;
      },
      view(name: string, arg?: unknown) {
        emit('view', { view: name, arg });
        return { view: name };
      },
      book,
      source,
      help,
      errors() {
        return ERRORS;
      },
      on(event: string, fn: (...a: any[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
        return () => listeners.get(event)!.delete(fn);
      },
      log(...xs: unknown[]) {
        const line = xs.map(x => (typeof x === 'string' ? x : toYaml(x))).join(' ');
        state.logs.push(line);
        emit('log', line);
        return undefined;
      },
      yaml: toYaml,
      backendOptions() {
        return { ...backendDefaults, ...backendExtras, about: { ...backendOptionsAbout } };
      },
      /** Run prototype-style synchronous code: `fn` gets a root on which async kernel calls are synchronous. */
      sync<T>(fn: (scope: { wb: any; p: any; project: any }) => T, opts: SyncOptions = {}) {
        return runSync(c => {
          const w = api(c);
          return fn({ wb: w, p: w.current, project: w.projects.current });
        }, opts);
      },
      get context() {
        return ctx;
      },
      _state: state,
      _emit: emit,
      _programHandle: (p: WbProgram) => programHandle(p, ctx),
      _projects: projects,
      _snapshot: snapshot,
      _restore(s: ReturnType<typeof snapshot>) {
        restore(s);
        emit('program', { program: state.current && state.current.name, why: 'revert' });
        return { restored: state.current ? `${state.current.id}@r${state.current.rev}` : null };
      },
      _describe() {
        return {
          version: root.version,
          current: state.current ? state.current.id : null,
          programs: [...state.programs.keys()],
          projects: projectsApi.list().length,
          passes: Object.keys(PASSES).length + USER_PASSES.size,
          analyses: FACTS.size,
          ...(ctx ? { context: ctx.label } : {}),
        };
      },
      _kernel: kernel,
    };
    return guard('Workbench', root);
  }
  return api(null);
}

export { runSync };
