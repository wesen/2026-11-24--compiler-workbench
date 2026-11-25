/**
 * Shared pieces of the workbench layer (a port of Compiler Workbench's base.js): refusals with a code and a fix
 * line, did-you-mean, guarded proxies that answer known members and refuse everything else, and the YAML the
 * console, the scripts view and the agent print results in.
 */
import { didYouMean } from '../typed/backend/errors.js';
import { WorkbenchError } from '../typed/program.js';

export { didYouMean, WorkbenchError };

/** Throw a refusal: `[code] message` plus a `fix:` line, as the prototype's WB.fail does. */
export function fail(code: string, message: string, extra: { fix?: string } = {}): never {
  throw new WorkbenchError(code, message, extra.fix);
}

const QUIET = new Set([
  'then',
  'toJSON',
  'constructor',
  'inspect',
  'nodeType',
  '$$typeof',
  'asymmetricMatch',
  'valueOf',
  'toString',
  'length',
  '__proto__',
  'prototype',
]);

function allKeys(o: object): string[] {
  const out: string[] = [];
  for (let p = Object.getPrototypeOf(o); p && p !== Object.prototype; p = Object.getPrototypeOf(p))
    for (const k of Object.getOwnPropertyNames(p)) if (k !== 'constructor') out.push(k);
  return out;
}

/** Who provides a member a handle lacks (fragments); set by the handle layer. */
export const guardHooks: { provider?: (kind: string, member: string) => string | null } = {};

/**
 * A read-only proxy: known members answer, an unknown one throws `unknownMember` with the nearest name, an
 * assignment throws `immutable`. Members starting with `_` may be set (internal bookkeeping).
 */
export function guard<T extends object>(kind: string, target: T, extraNames: readonly string[] = []): T {
  return new Proxy(target, {
    get(t: any, k) {
      if (typeof k === 'symbol' || k in t || QUIET.has(k) || k.startsWith('_')) return t[k];
      const names = [...new Set([...Object.keys(t), ...allKeys(t), ...extraNames])].filter(
        n => !n.startsWith('_'),
      );
      const from = guardHooks.provider?.(kind, k) ?? null;
      const near = didYouMean(k, names);
      return fail(
        'unknownMember',
        `${kind} has no member "${k}".` + (near ? ` Did you mean "${near}"?` : ''),
        {
          fix: from
            ? `fragment "${from}" provides it: wb.use('${from}')`
            : `${kind} members: ${names.slice(0, 24).join(', ')}`,
        },
      );
    },
    set(t: any, k, v) {
      if (typeof k === 'string' && k.startsWith('_')) {
        t[k] = v;
        return true;
      }
      return fail('immutable', `${kind} is read-only; assigning .${String(k)} has no effect.`, {
        fix: 'change programs only through passes (tx) or their files: p.apply(pass), project.files.write(path, text)',
      });
    },
    deleteProperty(_t, k) {
      return fail('immutable', `${kind} is read-only; delete .${String(k)} has no effect.`);
    },
  }) as T;
}

// ---------- YAML, the format results print in ----------
const PLAIN = /^[A-Za-z0-9 _.,:/()+\-·×→%#@'=<>!?*[\]{}|&^~$]*$/;
function yamlScalar(v: unknown): string | null {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e5) / 1e5) : String(v);
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
  const s = String(v);
  if (s === '') return '""';
  if (s.includes('\n')) return null;
  if (s.length < 120 && PLAIN.test(s) && !/^[\s\-?:[{]|:\s|\s$/.test(s) && !/^(true|false|null|\d)/.test(s))
    return s;
  return JSON.stringify(s);
}

export function yaml(value: any, depth = 0, seen = new Set<unknown>()): string {
  const pad = '  '.repeat(depth);
  const sc = yamlScalar(value);
  if (typeof value !== 'object' || value === null) {
    if (sc !== null) return sc;
    return (
      '|\n' +
      String(value)
        .split('\n')
        .map(l => pad + '  ' + l)
        .join('\n')
    );
  }
  if (seen.has(value)) return '[circular]';
  if (typeof value.then === 'function') return '[a Promise: await it]';
  if (typeof value._describe === 'function') value = value._describe();
  if (depth > 5) return Array.isArray(value) ? `[array ${value.length}]` : '{…}';
  seen = new Set(seen);
  seen.add(value);
  if (value instanceof Map) value = Object.fromEntries(value);
  if (value instanceof Set) value = [...value];
  if (ArrayBuffer.isView(value)) value = Array.from(value as unknown as ArrayLike<number>);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every(x => typeof x === 'number')) {
      const shown = value.slice(0, 64).map(yamlScalar).join(', ');
      return '[' + shown + (value.length > 64 ? `, … ${value.length - 64} items` : '') + ']';
    }
    const items = value.slice(0, 60).map(x => {
      const inner = yaml(x, depth + 1, seen);
      if (
        typeof x === 'object' &&
        x !== null &&
        !Array.isArray(x) &&
        !(x instanceof Map) &&
        inner.includes('\n')
      )
        return pad + '- ' + inner.replace(/^\s+/, '');
      return pad + '- ' + inner;
    });
    if (value.length > 60) items.push(pad + `# … ${value.length - 60} more`);
    return '\n' + items.join('\n');
  }
  const keys = Object.keys(value).filter(k => !k.startsWith('_'));
  if (!keys.length) return '{}';
  const lines = keys.slice(0, 80).map(k => {
    const v = value[k];
    const inner = yaml(v, depth + 1, seen);
    if (inner.startsWith('\n')) return pad + k + ':' + inner;
    if (
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      inner !== '{}' &&
      !inner.startsWith('[') &&
      inner !== '[circular]'
    )
      return pad + k + ':\n' + inner;
    return pad + k + ': ' + inner;
  });
  if (keys.length > 80) lines.push(pad + `# … ${keys.length - 80} more keys`);
  return lines.join('\n');
}

export function toYaml(v: unknown): string {
  const s = yaml(v);
  return s.startsWith('\n') ? s.slice(1) : s;
}

export const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Error codes, what they mean, and the usual fix (the prototype's WB.ERRORS, plus this layer's own). */
export const ERRORS: Readonly<Record<string, string>> = {
  unknownMember: 'a handle has no such member; the message suggests the nearest name and lists the members',
  immutable: 'handles are read-only; change a program through a pass (p.apply) or its project files',
  absent: 'no entity with that id in this program',
  unknownFunction: 'the program has no function by that name',
  unknownPass: 'no pass by that name; wb.passes() lists them',
  unknownAnalysis: 'no analysis by that name; wb.analyses() lists them',
  unknownPipeline: 'no pipeline by that name; wb.pipelines() lists them',
  unknownProject: 'no project by that id; wb.projects.list()',
  unknownScript: 'the project has no script by that name; project.scripts()',
  unknownFile: 'the project has no file by that path; project.files.list()',
  scriptSyntax: 'a script file does not parse as the body of a function',
  badPath: 'a file path is letters, digits, _ . / and -',
  badJson: 'project.json does not parse',
  useProjectFiles: 'a project program changes through its files, not p.edit',
  missingBecause: 'tx.remove needs { because: [...] }: say what makes the removal valid',
  noFixpoint: 'an analysis did not settle',
  frontEndError: 'the typed front end rejected the source (line and column given)',
  notCompiled: 'the program did not pass the front end',
  contractRejected: 'a pass changed what the program computes on some generated case; nothing was kept',
  readOnly: 'read-only mode: the call would change a program or a project file',
  badProject: 'a project id or import is malformed',
  builtinProject: 'built-in projects cannot be removed; reset() discards your edits',
  duplicateProject: 'a project with that id exists',
  notBuiltin: 'only a built-in project has an original to reset to',
  unsupported: 'the backend has no tile for this operation',
  noReference: 'reference images are not shipped in this build',
  fragmentConflict: 'two fragments define the same member on the same kind',
  unknownOption: 'the backend has no option by that name; wb.backendOptions()',
  noProject: 'the call reads the open project, and none is open',
  async:
    'this call runs the async kernel; await it (outside scripts), or run the code as a script, a query or in the console',
  notDeterministic:
    'a script asked for different async work on each replay (it reads a clock or random numbers)',
  sideEffectInQuery: 'queries are read-only; change the program in a button handler or a task',
};
