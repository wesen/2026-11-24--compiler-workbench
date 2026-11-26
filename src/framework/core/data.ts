import { sha256Parts } from './sha256.js';

/**
 * Values that `immutable` produced: deep-frozen plain records and arrays in canonical form (finite numbers, -0 as 0,
 * no accessors, symbols, holes or cycles). Nothing in one can change, so its canonical text is fixed: `canonical`
 * may cache it, and `immutable` returns such a value as it is. Only `immutable` adds to this set, and only objects
 * it built itself.
 */
const CANONICAL = new WeakSet<object>();
/**
 * Canonical text of canonical values of at least `RECORD_MIN` characters. IRWB-001 kept only large values (4,096
 * characters or more); IRWB-004 also keeps records, so a program value whose records survive a pass is encoded by
 * looking up its records' texts. Tiny values are cheaper to encode again than to keep.
 */
const TEXT = new WeakMap<object, string>();
const RECORD_MIN = 64;

/** Canonical finite JSON. Rejects values that would make persistent keys ambiguous. */
export function canonical(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(v: unknown): string {
    if (v === null) return 'null';
    if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('IR data must contain only finite numbers');
      return Object.is(v, -0) ? '0' : String(v);
    }
    if (typeof v !== 'object') throw new Error(`IR data cannot contain ${typeof v}`);
    const cached = TEXT.get(v);
    if (cached !== undefined) return cached;
    if (ancestors.has(v)) throw new Error('IR data cannot contain cycles');
    const prototype = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && prototype !== Object.prototype && prototype !== null) {
      throw new Error('IR data must be plain records or arrays');
    }
    ancestors.add(v);
    let result: string;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length)
        throw new Error('IR arrays cannot be sparse or have extra properties');
      if (Object.getOwnPropertySymbols(v).length) throw new Error('IR arrays cannot contain symbol keys');
      const entries: string[] = [];
      for (let i = 0; i < v.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
        if (!descriptor || !('value' in descriptor))
          throw new Error('IR arrays require own data elements without holes or accessors');
        entries.push(encode(descriptor.value));
      }
      result = '[' + entries.join(',') + ']';
    } else {
      if (Object.getOwnPropertySymbols(v).length) throw new Error('IR data cannot contain symbol keys');
      result =
        '{' +
        Object.keys(v)
          .sort()
          .map(k => {
            const descriptor = Object.getOwnPropertyDescriptor(v, k)!;
            if (!('value' in descriptor)) throw new Error('IR data cannot contain accessors');
            return JSON.stringify(k) + ':' + encode(descriptor.value);
          })
          .join(',') +
        '}';
    }
    ancestors.delete(v);
    if (result.length >= RECORD_MIN && CANONICAL.has(v)) TEXT.set(v, result);
    return result;
  }
  return encode(value);
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * A deep-frozen canonical copy: what `JSON.parse(canonical(value))`, deep-frozen, would give (keys in sorted order,
 * -0 as 0), built directly instead of through text, with the same rejections as `canonical`. A value that
 * `immutable` produced is returned as it is; canonical parts of a new value are shared, not copied.
 */
export function immutable<T>(value: T): T {
  const ancestors = new Set<object>();
  function build(v: unknown): unknown {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new Error('IR data must contain only finite numbers');
      return Object.is(v, -0) ? 0 : v;
    }
    if (typeof v !== 'object') throw new Error(`IR data cannot contain ${typeof v}`);
    if (CANONICAL.has(v)) return v;
    if (ancestors.has(v)) throw new Error('IR data cannot contain cycles');
    const prototype = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && prototype !== Object.prototype && prototype !== null) {
      throw new Error('IR data must be plain records or arrays');
    }
    ancestors.add(v);
    let out: unknown[] | Record<string, unknown>;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length)
        throw new Error('IR arrays cannot be sparse or have extra properties');
      if (Object.getOwnPropertySymbols(v).length) throw new Error('IR arrays cannot contain symbol keys');
      const items: unknown[] = new Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(v, String(i));
        if (!descriptor || !('value' in descriptor))
          throw new Error('IR arrays require own data elements without holes or accessors');
        items[i] = build(descriptor.value);
      }
      out = items;
    } else {
      if (Object.getOwnPropertySymbols(v).length) throw new Error('IR data cannot contain symbol keys');
      // JSON.parse gives a plain object with own data properties in text order (here: sorted); defineProperty
      // keeps a "__proto__" key an own property, as JSON.parse does
      const record: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(v, k)!;
        if (!('value' in descriptor)) throw new Error('IR data cannot contain accessors');
        Object.defineProperty(record, k, {
          value: build(descriptor.value),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      out = record;
    }
    ancestors.delete(v);
    Object.freeze(out);
    CANONICAL.add(out);
    return out;
  }
  return build(value) as T;
}

/**
 * Portable SHA-256 for identical browser/Node content addresses; no platform or npm dependency. IRWB-004: the
 * implementation is in sha256.ts (node:crypto in Node, a streaming portable one elsewhere); the digest is unchanged.
 */
export function sha256(text: string): string {
  return sha256Parts([text]);
}

const HASH = new WeakMap<object, string>();
export function fingerprint(value: unknown): string {
  if (value && typeof value === 'object' && CANONICAL.has(value)) {
    let h = HASH.get(value);
    if (h === undefined) HASH.set(value, (h = sha256(canonical(value))));
    return h;
  }
  return sha256(canonical(value));
}

const REVISION = new WeakMap<object, Map<string, string>>();
/**
 * IRWB-004: `fingerprint({ kind, schemaVersion, value })`, an artifact's revision, computed once per canonical value.
 * The canonical text of that record is `{"kind":K,"schemaVersion":S,"value":V}` (keys sorted, strings JSON-encoded),
 * so it is hashed from its three pieces without building it, V being the value's (cached) canonical text.
 */
export function revisionOf(kind: string, schemaVersion: string, value: unknown): string {
  if (typeof kind !== 'string' || typeof schemaVersion !== 'string')
    return fingerprint({ kind, schemaVersion, value });
  const hashIt = () =>
    sha256Parts([
      '{"kind":' + JSON.stringify(kind) + ',"schemaVersion":' + JSON.stringify(schemaVersion) + ',"value":',
      canonical(value),
      '}',
    ]);
  if (!value || typeof value !== 'object' || !CANONICAL.has(value)) return hashIt();
  const key = kind + '\u0000' + schemaVersion;
  let m = REVISION.get(value);
  if (!m) REVISION.set(value, (m = new Map()));
  let h = m.get(key);
  if (h === undefined) m.set(key, (h = hashIt()));
  return h;
}

const VALIDATED = new WeakMap<object, WeakSet<object>>();
/**
 * IRWB-004: run `validator(value)` unless it already accepted this canonical value. A canonical value cannot change
 * and validators are deterministic, so the verdict would be the same; a value that failed is validated again (and
 * fails again). `check` receives the validator's result (e.g. to require that it is not a promise); the validator is
 * called with `thisArg` as `this`, as a method call on its owner would.
 */
export function validateOnce<V>(
  validator: (value: V) => unknown,
  value: V,
  check?: (result: unknown) => void,
  thisArg?: unknown,
): void {
  const cacheable = !!value && typeof value === 'object' && CANONICAL.has(value as object);
  const seen = cacheable ? VALIDATED.get(validator) : undefined;
  if (seen?.has(value as object)) return;
  const result = validator.call(thisArg, value);
  check?.(result);
  if (!cacheable) return;
  let s = seen ?? VALIDATED.get(validator);
  if (!s) VALIDATED.set(validator, (s = new WeakSet()));
  s.add(value as object);
}

/** True for values `immutable` produced: deep-frozen, canonical, already validated. */
export function isCanonical(value: unknown): boolean {
  return !!value && typeof value === 'object' && CANONICAL.has(value);
}

/**
 * `canonical(a) === canonical(b)`, decided without building text: both are made canonical (free for values
 * `immutable` produced), then compared structurally (canonical records have sorted keys, so equal records have
 * equal key lists).
 */
export function sameCanonical(a: unknown, b: unknown): boolean {
  const eq = (x: unknown, y: unknown): boolean => {
    if (x === y) return true;
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return false;
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    const kx = Object.keys(x),
      ky = Object.keys(y);
    if (kx.length !== ky.length) return false;
    for (let i = 0; i < kx.length; i++) {
      if (kx[i] !== ky[i]) return false;
      if (!eq((x as Record<string, unknown>)[kx[i]], (y as Record<string, unknown>)[ky[i]])) return false;
    }
    return true;
  };
  return eq(immutable(a), immutable(b));
}
