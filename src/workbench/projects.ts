/**
 * Projects: a project is a set of plain files (a port of Compiler Workbench's projects.js).
 *   project.json      title, about, group, sources (order), inputs, pipeline, scripts, ui, chapter, try
 *   *.typed           typed source; all of them compile together, in the order project.json gives
 *   scripts/*.js      workbench scripts: the body of a function with wb, p, project, args, param, log in scope
 *   ui/*.js           UI scripts: the body of a function with ui, wb, p, project in scope; returns tiles
 *   notes.md          notes, shown under the source
 * Built-in projects come with the build (corpus/projects). Edits to one are kept in the browser's storage as an
 * overlay (reset brings the original back); projects you make are kept whole.
 *
 * Programs are built by the kernel's root (`createWorkbench().open(id, files)`, `projectSource`); scripts run in a
 * `SyncContext`, so the corpus's synchronous scripts drive the async kernel unchanged.
 */
import { hash } from '../typed/evaluate.js';
import { formatJson, joinText, splitWords, TILE_WIDTH } from '../typed/format.js';
import { Program } from '../typed/program.js';
import { projectSource } from '../typed/project.js';
import { didYouMean, fail, guard, toYaml, WorkbenchError } from './base.js';
import { WbProgram } from './programs.js';
import { candelaInputs } from './candela-inputs.js';
import { storeOf } from '../typed/ir.js';
import { keyOf, runAsync, runSync, settle, unwrap, type Outcome, type SyncContext } from './sync.js';

export const KEY = 'wb.projects.v1';

/**
 * A project.json the workbench writes: prose fields as lines that fit a tile (JSON strings cannot span lines;
 * readers join them), and the whole at most TILE_WIDTH columns (as tools/format-corpus.mjs does for the corpus).
 */
export function projectJson(meta: Record<string, unknown>): string {
  const lines = (text: unknown, indent: number) =>
    typeof text !== 'string' || indent + text.length + 3 <= TILE_WIDTH
      ? text
      : splitWords(text, TILE_WIDTH - indent - 3);
  const out: Record<string, unknown> = { ...meta };
  if (out.about !== undefined) out.about = lines(joinText(out.about), 4);
  if (Array.isArray(out.try)) out.try = out.try.map(t => lines(joinText(t), 6));
  if (out.scripts && typeof out.scripts === 'object')
    out.scripts = Object.fromEntries(
      Object.entries(out.scripts as Record<string, Record<string, unknown>>).map(([k, v]) => [
        k,
        v && v.about !== undefined ? { ...v, about: lines(joinText(v.about), 8) } : v,
      ]),
    );
  return formatJson(out);
}
export type FileKind = 'typed' | 'script' | 'ui' | 'meta' | 'notes' | 'strategy' | 'json' | 'file';
export const kindOf = (path: string): FileKind =>
  /\.typed$/.test(path)
    ? 'typed'
    : /^scripts\/.+\.js$/.test(path)
      ? 'script'
      : /^ui\/.+\.js$/.test(path)
        ? 'ui'
        : path === 'project.json'
          ? 'meta'
          : /\.md$/.test(path)
            ? 'notes'
            : /^strategies\/[^/]+\.json$/.test(path)
              ? 'strategy'
              : /\.json$/.test(path)
                ? 'json'
                : 'file';
const nameOf = (path: string) => path.replace(/^.*\//, '').replace(/\.js$/, '');
export const SCRIPT_SCOPE = ['wb', 'p', 'project', 'args', 'param', 'log', 'yaml'];
export const UI_SCOPE = ['ui', 'wb', 'p', 'project', 'param'];

export interface BuiltinProject {
  readonly id: string;
  readonly files: Readonly<Record<string, string>>;
}
export interface Storage {
  get(key: string): string | null | undefined;
  set(key: string, value: string): void;
}

// Compile a script body. Plain bodies run synchronously; a body that uses await runs as an async function.
const compiled = new Map<string, (...a: unknown[]) => unknown>();
export function compileBody(
  body: string,
  names: readonly string[],
  label: string,
): (...a: unknown[]) => unknown {
  const key = names.join(',') + '\n' + body;
  const hit = compiled.get(key);
  if (hit) return hit;
  let fn: (...a: unknown[]) => unknown;
  try {
    fn = new Function(...names, '"use strict";\n' + body + '\n//# sourceURL=' + label) as never;
  } catch (e) {
    if (!/await/.test(String((e as Error).message)) && !/\bawait\b/.test(body))
      throw new WorkbenchError(
        'scriptSyntax',
        `${label}: ${(e as Error).message}`,
        'a script is the body of a function: statements, then return a value',
      );
    try {
      const A = Object.getPrototypeOf(async function () {}).constructor;
      fn = new A(...names, '"use strict";\n' + body + '\n//# sourceURL=' + label);
    } catch (e2) {
      throw new WorkbenchError(
        'scriptSyntax',
        `${label}: ${(e2 as Error).message}`,
        'a script is the body of a function: statements, then return a value',
      );
    }
  }
  compiled.set(key, fn);
  return fn;
}

/** What a leading comment says a script is about, up to the end of its first sentence. */
export const firstComment = (text: string): string => {
  const lead: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*\/\/\s?(.*)$/);
    if (!m) break;
    lead.push(m[1].trim());
  }
  const all = lead.join(' ').trim(),
    end = all.search(/[.!?](\s|$)/);
  const first = end >= 0 ? all.slice(0, end + 1) : all;
  return first.length > 160 ? first.slice(0, 157) + '…' : first;
};
const ORDER: Record<FileKind, number> = {
  meta: 0,
  notes: 1,
  typed: 2,
  script: 3,
  ui: 4,
  strategy: 5,
  json: 6,
  file: 7,
};
const sortFiles = (a: string, b: string) => ORDER[kindOf(a)] - ORDER[kindOf(b)] || a.localeCompare(b);

/** The workbench state projects read and change (owned by the root, workbench.ts). */
export interface ProjectState {
  programs: Map<string, WbProgram>;
  current: WbProgram | null;
  projectId: string | null;
  focus: string | null;
  paramDefs: Map<string, unknown>;
  paramValues: Record<string, unknown>;
}
export interface ProjectEnv {
  readonly state: ProjectState;
  readonly kernel: { open(id: string, files: Readonly<Record<string, string>>): Program };
  emit(event: string, data?: unknown): void;
  writes(what: string, ctx: SyncContext | null): void;
  /** Note that a context changes the workbench state (files, the open project), so a replay can put it back. */
  touchState(ctx: SyncContext | null): void;
  api(ctx: SyncContext | null): any;
}

export function makeProjects(
  env: ProjectEnv,
  builtinList: readonly BuiltinProject[],
  storage: Storage | null,
) {
  const { state } = env;
  const builtins = new Map(builtinList.map(x => [x.id, x]));
  let saved: Record<
    string,
    { user?: boolean; files?: Record<string, string | null>; uiOff?: string[]; created?: string }
  > = {};
  try {
    saved = JSON.parse((storage && storage.get(KEY)) || '{}') || {};
  } catch {
    saved = {};
  }
  const persist = () => {
    if (storage) storage.set(KEY, JSON.stringify(saved));
  };
  const ids = () => [...new Set([...builtins.keys(), ...Object.keys(saved).filter(id => saved[id].user)])];
  const exists = (id: string) => builtins.has(id) || !!(saved[id] && saved[id].user);
  const need = (id: string) => {
    if (!exists(id)) {
      const near = didYouMean(id, ids());
      fail('unknownProject', `no project "${id}".` + (near ? ` Did you mean "${near}"?` : ''), {
        fix: 'wb.projects.list() shows them',
      });
    }
  };
  /** The files of a project: the original, with this browser's edits laid over it. */
  function filesOf(id: string): Record<string, string> {
    const base: Record<string, string> = builtins.has(id) ? { ...builtins.get(id)!.files } : {};
    const over = (saved[id] && saved[id].files) || {};
    for (const [path, text] of Object.entries(over)) {
      if (text === null) delete base[path];
      else base[path] = text;
    }
    return base;
  }
  function metaOf(id: string): Record<string, any> {
    const files = filesOf(id);
    let m: Record<string, any> = {};
    if (files['project.json']) {
      try {
        m = JSON.parse(files['project.json']);
      } catch (e) {
        m = { _error: (e as Error).message };
      }
    }
    // prose fields may be arrays of lines (so project.json fits a tile): they mean the joined text
    if (m.about !== undefined) m.about = joinText(m.about);
    if (Array.isArray(m.try)) m.try = m.try.map((x: unknown) => joinText(x));
    if (m.scripts && typeof m.scripts === 'object')
      for (const sc of Object.values(m.scripts as Record<string, Record<string, unknown>>))
        if (sc && sc.about !== undefined) sc.about = joinText(sc.about);
    const typed = Object.keys(files)
      .filter(f => kindOf(f) === 'typed')
      .sort();
    const named: string[] = Array.isArray(m.sources) ? m.sources : [];
    const sources = named.filter(f => files[f] !== undefined).concat(typed.filter(f => !named.includes(f)));
    return {
      title: id,
      about: '',
      group: 'Mine',
      pipeline: 'O2',
      inputs: {},
      scripts: {},
      ui: {},
      ...m,
      sources,
    };
  }
  /** Only the files the program is built from (project.json for its inputs and order, and the sources). */
  const buildFiles = (id: string) => {
    const f = filesOf(id),
      out: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (k === 'project.json' || kindOf(k) === 'typed') out[k] = v;
    return out;
  };
  const sigOf = (id: string) => hash(JSON.stringify(buildFiles(id)));

  // one compiled program per project, rebuilt when its typed files or project.json change
  const programs = new Map<string, { sig: string; q: WbProgram }>();
  const builds = new Map<string, WbProgram>(); // by signature: a replayed write finds the same program
  const templates = new Map<string, WbProgram>(); // fresh copies, by signature: ingested once
  /**
   * A kernel program for a project. project.json may say how to ingest (`"ingest": { "tape": true,
   * "maxSourceLength": n }`, for Candela) and where check inputs come from (`"inputsFrom": "candela"`: derived from
   * the lifted program, so the gate's cases fit Candela's records).
   */
  function kernelFor(id: string, files: Record<string, string>, name?: string): Program {
    const meta = metaOf(id);
    const ingest = meta.ingest && typeof meta.ingest === 'object' ? meta.ingest : null;
    const entries = Array.isArray(meta.entries) ? (meta.entries as string[]) : null;
    if (!ingest && !entries && !meta.inputsFrom) return env.kernel.open(id, files);
    const ps = projectSource(id, files);
    const inputs: Record<string, unknown> = { ...((ps.meta.inputs as Record<string, unknown>) ?? {}) };
    const k = new Program(name ?? ps.name, ps.source, {
      inputs: inputs as never,
      fileMap: ps.fileMap,
      project: id,
      ...(ingest ? { ingest } : {}),
      ...(entries ? { entries } : {}),
    });
    // the Program reads its inputs object on every check; fill it once the program is lifted
    if (meta.inputsFrom === 'candela' && k.status === 'ok')
      Object.assign(inputs, candelaInputs(storeOf(k.head.value)));
    return k;
  }
  function build(id: string, fresh = false): WbProgram {
    const files = buildFiles(id);
    if (!fresh) {
      const k = kernelFor(id, files);
      return new WbProgram(k, { project: id, fileMap: k.options.fileMap });
    }
    const key = `${id}:${hash(JSON.stringify(files))}`;
    let t = templates.get(key);
    if (!t) {
      const ps = projectSource(id, files);
      const k = kernelFor(id, files, `${ps.name}_fresh`);
      if (templates.size > 32) templates.clear();
      templates.set(key, (t = new WbProgram(k, { project: id, scratch: true, fileMap: k.options.fileMap })));
    }
    // a copy at r0 that shares the template's ingest and analysis cache, not its revisions
    return new WbProgram(t.scratchKernel(t.chain.slice(0, 1)), {
      project: id,
      scratch: true,
      fileMap: t.fileMap,
    });
  }
  function programFor(id: string): WbProgram {
    const sig = sigOf(id);
    let e = programs.get(id);
    if (!e || e.sig !== sig) {
      const q = builds.get(`${id}:${sig}`) ?? build(id);
      if (builds.size > 64) builds.clear();
      builds.set(`${id}:${sig}`, q);
      e = { sig, q };
      programs.set(id, e);
      state.programs.set(q.name, q);
      if (state.current && state.current.project === id && state.current !== q) {
        state.current = q;
        env.emit('program', { program: q.name, why: 'source', project: id });
      }
    }
    return e.q;
  }

  // ---------- scripts ----------
  const freshMemo = new Map<string, Outcome>();
  function runScript(
    id: string,
    name: string,
    args: Record<string, unknown> = {},
    opts: { fresh?: boolean; logs?: string[]; readOnly?: boolean } = {},
    ctx: SyncContext | null = null,
  ): unknown {
    const files = filesOf(id),
      path = `scripts/${name}.js`;
    if (files[path] === undefined) {
      const names = Object.keys(files)
        .filter(f => kindOf(f) === 'script')
        .map(nameOf);
      const near = didYouMean(name, names);
      fail(
        'unknownScript',
        `project "${id}" has no script "${name}".` + (near ? ` Did you mean "${near}"?` : ''),
        {
          fix: `scripts: ${names.join(', ') || 'none yet: add scripts/<name>.js'}`,
        },
      );
    }
    const conf = (metaOf(id).scripts || {})[name] || {};
    const fresh = !!(conf.fresh || opts.fresh);
    const fn = compileBody(files[path], SCRIPT_SCOPE, `${id}/${path}`);
    const logs = opts.logs ?? [];
    const label = `${id}/${path}`;
    const exec = (c: SyncContext) => {
      const api = env.api(c);
      const q = fresh ? build(id, true) : programFor(id);
      const log = (x: unknown) => {
        logs.push(typeof x === 'string' ? x : toYaml(x));
      };
      return fn(api, api._programHandle(q), api.projects.get(id), args, api.param, log, toYaml);
    };
    const onAttempt = () => {
      logs.length = 0;
    };
    if (!fresh) {
      if (ctx && !ctx.closed) return exec(ctx);
      return runSync(exec, { label, readOnly: opts.readOnly, onAttempt });
    }
    // a fresh copy depends only on the files, the arguments and the parameters: remember its result
    const key = `run|${id}|${hash(JSON.stringify(files))}|${name}|${keyOf(args)}|${keyOf(state.paramValues)}`;
    const hit = freshMemo.get(key);
    if (hit) return unwrap(hit);
    const remember = (o: Outcome) => {
      if (o.ok) {
        if (freshMemo.size > 200) freshMemo.clear();
        freshMemo.set(key, o);
      }
      return o;
    };
    if (ctx && !ctx.closed)
      return ctx.op(
        `script ${name}`,
        key,
        async () => remember(await settle(() => runAsync(exec, { label, onAttempt }))),
        unwrap,
      );
    const r = runSync(exec, { label, onAttempt });
    if (r && typeof (r as Promise<unknown>).then === 'function')
      return (r as Promise<unknown>).then(v => {
        remember({ ok: true, value: v });
        return v;
      });
    remember({ ok: true, value: r });
    return r;
  }

  const write = (id: string, path: string, text: string | null, ctx: SyncContext | null) => {
    env.touchState(ctx);
    const s = (saved[id] = saved[id] || { files: {} });
    s.files = s.files || {};
    if (text === null) {
      if (builtins.has(id) && builtins.get(id)!.files[path] !== undefined) s.files[path] = null;
      else delete s.files[path];
    } else s.files[path] = text;
    persist();
  };

  // ---------- the handle a script, the console or the agent gets ----------
  function handle(id: string, ctx: SyncContext | null): any {
    need(id);
    const api = () => env.api(ctx);
    const H: any = {
      get id() {
        return id;
      },
      get title() {
        return metaOf(id).title;
      },
      get about() {
        return metaOf(id).about;
      },
      get group() {
        return metaOf(id).group;
      },
      get meta() {
        return JSON.parse(JSON.stringify(metaOf(id)));
      },
      get builtin() {
        return builtins.has(id);
      },
      get program() {
        return api()._programHandle(programFor(id));
      },
      fresh() {
        return api()._programHandle(build(id, true));
      },
      sources() {
        return metaOf(id).sources.slice();
      },
      files: guard('Files', {
        list() {
          const f = filesOf(id),
            over = (saved[id] && saved[id].files) || {};
          return Object.keys(f)
            .sort(sortFiles)
            .map(path => ({
              path,
              kind: kindOf(path),
              lines: f[path].split('\n').length,
              ...(builtins.has(id) && path in over ? { edited: true } : {}),
            }));
        },
        read(path: string) {
          const f = filesOf(id);
          if (f[path] === undefined) {
            const near = didYouMean(path, Object.keys(f));
            fail(
              'unknownFile',
              `project "${id}" has no file "${path}".` + (near ? ` Did you mean "${near}"?` : ''),
              {
                fix: `files: ${Object.keys(f).sort(sortFiles).join(', ')}`,
              },
            );
          }
          return f[path];
        },
        write(path: string, text: string) {
          env.writes('project.files.write', ctx);
          if (typeof path !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(path) || path.includes('..'))
            fail('badPath', `"${path}" is not a file path: letters, digits, _ . / -`, {
              fix: 'kernels.typed, scripts/report.js, ui/dashboard.js, notes.md',
            });
          if (typeof text !== 'string') fail('badArgument', 'write(path, text): text is a string');
          if (path === 'project.json') {
            try {
              JSON.parse(text);
            } catch (e) {
              fail('badJson', `project.json does not parse: ${(e as Error).message}`);
            }
          }
          if (/\.js$/.test(path))
            compileBody(text, kindOf(path) === 'ui' ? UI_SCOPE : SCRIPT_SCOPE, `${id}/${path}`);
          write(id, path, text, ctx);
          env.emit('files', { project: id, path, kind: kindOf(path) });
          if (kindOf(path) === 'typed' || path === 'project.json') programFor(id);
          return { written: path, lines: text.split('\n').length };
        },
        remove(path: string) {
          env.writes('project.files.remove', ctx);
          H.files.read(path);
          write(id, path, null, ctx);
          env.emit('files', { project: id, path, kind: kindOf(path), removed: true });
          if (kindOf(path) === 'typed') programFor(id);
          return { removed: path };
        },
        rename(from: string, to: string) {
          const t = H.files.read(from);
          H.files.write(to, t);
          H.files.remove(from);
          return { renamed: from, to };
        },
      }),
      scripts() {
        const f = filesOf(id),
          m = metaOf(id);
        return Object.keys(f)
          .filter(x => kindOf(x) === 'script')
          .sort()
          .map(x => ({
            name: nameOf(x),
            path: x,
            about: ((m.scripts || {})[nameOf(x)] || {}).about || firstComment(f[x]),
          }));
      },
      /** In the order project.json's ui.order gives (registrations first), then by name. */
      uiScripts() {
        const f = filesOf(id),
          m = metaOf(id),
          off = new Set<string>((m.ui && m.ui.off) || []),
          en = saved[id] && saved[id].uiOff,
          first: string[] = (m.ui && m.ui.order) || [];
        const rank = (x: string) => {
          const i = first.indexOf(nameOf(x));
          return i < 0 ? first.length : i;
        };
        return Object.keys(f)
          .filter(x => kindOf(x) === 'ui')
          .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
          .map(x => ({
            name: nameOf(x),
            path: x,
            on: en ? !en.includes(nameOf(x)) : !off.has(nameOf(x)),
            about: firstComment(f[x]),
          }));
      },
      setUi(name: string, on: boolean) {
        const s = (saved[id] = saved[id] || { files: {} });
        const m = metaOf(id);
        const off = new Set<string>(s.uiOff || (m.ui && m.ui.off) || []);
        if (on) off.delete(name);
        else off.add(name);
        s.uiOff = [...off];
        persist();
        env.emit('ui', { project: id, name, on });
        return { ui: name, on };
      },
      run(name: string, args: Record<string, unknown> = {}, opts: { fresh?: boolean; logs?: string[] } = {}) {
        return runScript(id, name, args, opts, ctx);
      },
      reset() {
        env.writes('project.reset', ctx);
        if (!builtins.has(id))
          fail('notBuiltin', `"${id}" is your own project; there is no original to go back to`);
        env.touchState(ctx);
        delete saved[id];
        persist();
        programs.delete(id);
        env.emit('files', { project: id, reset: true });
        programFor(id);
        return { reset: id };
      },
      export() {
        return JSON.stringify({ id, files: filesOf(id) }, null, 2);
      },
      describe() {
        const m = metaOf(id),
          q = programFor(id);
        return {
          id,
          title: m.title,
          group: m.group,
          about: m.about,
          builtin: builtins.has(id),
          sources: m.sources,
          status: q.k.status,
          ...(q.error ? { error: q.error } : {}),
          fns: q.fns(),
          scripts: H.scripts().map((s: { name: string }) => s.name),
          ui: H.uiScripts().map((u: { name: string; on: boolean }) => u.name + (u.on ? '' : ' (off)')),
        };
      },
      _describe() {
        return H.describe();
      },
      _key: `project:${id}`,
    };
    return guard('Project', H);
  }

  // ---------- wb.projects ----------
  const make = (ctx: SyncContext | null) => {
    const api: any = {
      list(filter: { group?: string; text?: string } = {}) {
        return ids()
          .map(id => ({ id, ...metaOf(id) }) as Record<string, any>)
          .filter(
            x =>
              (!filter.group || x.group === filter.group) &&
              (!filter.text ||
                (x.title + ' ' + x.about + ' ' + x.id)
                  .toLowerCase()
                  .includes(String(filter.text).toLowerCase())),
          )
          .map(x => ({
            id: x.id,
            title: x.title,
            group: x.group,
            about: x.about,
            ui: Object.keys(filesOf(x.id)).filter(f => kindOf(f) === 'ui').length,
            ...(builtins.has(x.id) ? {} : { mine: true }),
            ...(builtins.has(x.id) &&
            saved[x.id] &&
            saved[x.id].files &&
            Object.keys(saved[x.id].files!).length
              ? { edited: true }
              : {}),
          }));
      },
      groups() {
        const g: Record<string, number> = {};
        for (const x of api.list()) g[x.group] = (g[x.group] || 0) + 1;
        return g;
      },
      get(id: string) {
        return handle(id, ctx);
      },
      open(id: string) {
        need(id);
        env.touchState(ctx);
        const q = programFor(id);
        if (state.projectId !== id) state.paramValues = {}; // parameters belong to a project
        state.current = q;
        state.projectId = id;
        state.focus = null;
        state.paramDefs = new Map();
        env.emit('program', { program: q.name, why: 'project', project: id });
        return handle(id, ctx);
      },
      get current() {
        return state.projectId && exists(state.projectId) ? handle(state.projectId, ctx) : null;
      },
      create(
        id: string,
        opts: {
          title?: string;
          about?: string;
          group?: string;
          source?: string;
          files?: Record<string, string>;
        } = {},
      ) {
        env.writes('projects.create', ctx);
        if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(id))
          fail('badProject', `project ids are lower-case words joined by dashes, not "${id}"`, {
            fix: "wb.projects.create('my-loops', { title: 'My loops' })",
          });
        if (exists(id))
          fail('duplicateProject', `a project "${id}" exists`, {
            fix: `wb.projects.get('${id}').files.write(...) changes it; pick another id for a new one`,
          });
        const files: Record<string, string> = opts.files || {
          'project.json': projectJson({
            title: opts.title || id,
            about: opts.about || '',
            group: opts.group || 'Mine',
            pipeline: 'O2',
          }),
          'main.typed': opts.source || 'function f(x: i32): i32 {\n    return x * 8 + 1;\n}\n',
          'scripts/explore.js':
            "// O2 on the program, and what it changed\np.pipeline('O2');\nreturn { revisions: p.revisions().length - 1, listing: p.listing() };\n",
          'notes.md': '',
        };
        if (!files['project.json'])
          files['project.json'] = projectJson({ title: opts.title || id, group: opts.group || 'Mine' });
        try {
          JSON.parse(files['project.json']);
        } catch (e) {
          fail('badJson', `project.json does not parse: ${(e as Error).message}`);
        }
        for (const [path, text] of Object.entries(files))
          if (/\.js$/.test(path))
            compileBody(text, kindOf(path) === 'ui' ? UI_SCOPE : SCRIPT_SCOPE, `${id}/${path}`);
        env.touchState(ctx);
        saved[id] = { user: true, files: { ...files }, created: new Date().toISOString() };
        persist();
        env.emit('projects', { created: id });
        const q = programFor(id);
        return {
          created: id,
          status: q.k.status,
          ...(q.error ? { error: q.error } : {}),
          note: 'kept in this browser; wb.projects.open(id) opens it',
        };
      },
      duplicate(id: string, newId: string, opts: { title?: string } = {}) {
        need(id);
        return api.create(newId, {
          files: {
            ...filesOf(id),
            'project.json': projectJson({
              ...JSON.parse(filesOf(id)['project.json'] || '{}'),
              title: opts.title || `${metaOf(id).title} (copy)`,
              group: 'Mine',
            }),
          },
        });
      },
      remove(id: string) {
        env.writes('projects.remove', ctx);
        need(id);
        if (builtins.has(id))
          fail('builtinProject', `"${id}" is built in; reset() discards your edits to it`);
        env.touchState(ctx);
        delete saved[id];
        programs.delete(id);
        persist();
        env.emit('projects', { removed: id });
        return { removed: id };
      },
      import(json: string | { id: string; files: Record<string, string> }) {
        env.writes('projects.import', ctx);
        const x = typeof json === 'string' ? JSON.parse(json) : json;
        if (!x || !x.id || !x.files) fail('badProject', 'import wants { id, files: { path: text } }');
        let id: string = x.id;
        while (exists(id)) id = id.replace(/(-\d+)?$/, m => '-' + (+(m || '-1').slice(1) + 1));
        return api.create(id, { files: x.files });
      },
      _files: filesOf,
      _meta: metaOf,
      _program: programFor,
      _saved: () => saved,
    };
    return guard('Projects', api);
  };

  /** A built-in project whose files arrive after the page loads (Candela, from its lazily loaded data). */
  function addBuiltin(p: BuiltinProject) {
    builtins.set(p.id, p);
    env.emit('projects', { added: p.id });
  }
  return {
    make,
    addBuiltin,
    filesOf,
    metaOf,
    programFor,
    exists,
    /** The overlay and the project programs, to put back on a replay or an agent revert. */
    snapshot() {
      return { saved: JSON.stringify(saved), programs: new Map(programs) };
    },
    restore(s: { saved: string; programs: Map<string, { sig: string; q: WbProgram }> }) {
      saved = JSON.parse(s.saved);
      persist();
      programs.clear();
      for (const [k, v] of s.programs) programs.set(k, v);
    },
  };
}
