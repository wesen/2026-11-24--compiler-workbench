/**
 * `rv32.image` as a v6 representation: an RV32IM image whose instructions are entities that record what they
 * cover. The native value is finite JSON: the code is a base64 string of the little-endian words, and one record
 * per instruction carries its word, the disassembler's text, its target named symbolically (`sym`, so diffs of
 * code that only moved line up), the typed.blocks ids it implements (`covers`) and why it exists when that is not
 * obvious (a copy, a spill, a frame).
 *
 * Entities: `fn:NAME` (kind `fn`) and `insn:NAME+0xOFF` (kind `insn.<op>`, the offset relative to the entry).
 * Relations:
 *   containment  contains (fn -> insn, ordered by address)
 *   control      jump (branch or jump -> the instruction at its target), calls (call -> fn)
 * `covers` is provenance into another IR, and a v6 graph refuses relations to entities it does not contain, so it
 * is an attribute (a list of typed.blocks ids). `imageCorrespondence` turns it into a v6 correspondence between
 * the typed.blocks revision and the image.
 */
import { defineIR } from '../../framework/contracts/definitions.js';
import type { Artifact } from '../../framework/core/types.js';
import { defineAdapter } from '../../framework/ir/adapters.js';
import { makeCorrespondence } from '../../framework/ir/correspondence.js';
import type {
  CorrespondenceEntry,
  EntityCorrespondence,
  IREntity,
  IRRelation,
} from '../../framework/ir/types.js';
import { blocksEntities } from '../ir.js';
import type { TypedBlocks } from '../model.js';
import { fail } from './errors.js';
import { decode } from './encode.js';
import { backendDefaults, type BackendOptions } from './options.js';

export interface ImageInsn {
  readonly id: string;
  readonly fn: string;
  /** Byte address in the image. */
  readonly offset: number;
  /** The machine operation the backend emitted (`addi`, `blt`, `call`, `ret`, ...). */
  readonly op: string;
  readonly word: number;
  /** The disassembler's reading of `word`. */
  readonly text: string;
  /** `text` with its target named (a block, `exit`, a local label, a callee) instead of addressed. */
  readonly sym: string;
  /** The typed.blocks ids this instruction implements: a value and its statement, or the function. */
  readonly covers: readonly string[];
  readonly why?: string;
  /** Branches and jumps: the byte address of the target, and its label. */
  readonly target?: number;
  readonly label?: string;
  readonly callee?: string;
}

/**
 * A function's signature by type class, for its ilp32f calling convention: parameters, the result, and a record
 * result's leaves. An image records it only for functions that a caller cannot call with integers in a0-a7 and a
 * result in a0 (an f32 parameter or result, a record result, more than eight parameters), so an integer image's
 * value, and its revision, are what they were before f32.
 */
export interface ImageSig {
  readonly params: readonly ('i32' | 'f32')[];
  readonly result: 'i32' | 'f32';
  readonly results?: readonly ('i32' | 'f32')[];
}

export interface ImageFn {
  readonly name: string;
  readonly entry: number;
  readonly bytes: number;
  readonly insns: number;
  readonly sig?: ImageSig;
  /** Allocation facts; absent for an image the backend did not make (a reference image). */
  readonly frame?: number;
  readonly saved?: readonly string[];
  readonly spills?: number;
  readonly regs?: readonly string[];
  readonly vregs?: number;
  readonly leaf?: boolean;
}

export interface Rv32Image {
  readonly formatVersion: 1;
  readonly program: string;
  /** The typed.blocks revision this image was lowered from, when it was. */
  readonly source: { readonly artifact: string; readonly revision: string } | null;
  /** The backend options, or null for an image another compiler made. */
  readonly options: BackendOptions | null;
  readonly bytes: number;
  /** Base64 of the little-endian code bytes. */
  readonly code: string;
  readonly entries: Readonly<Record<string, number>>;
  /** Function names in layout order (entries ascending). */
  readonly fnOrder: readonly string[];
  readonly fns: Readonly<Record<string, ImageFn>>;
  /** Every instruction, by address. */
  readonly insns: readonly ImageInsn[];
}

// ---------- base64, without depending on a host's Buffer or btoa ----------
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=') +
      (i + 2 < bytes.length ? ALPHABET[n & 63] : '=');
  }
  return out;
}
export function fromBase64(text: string): Uint8Array {
  if (text.length % 4 || /[^A-Za-z0-9+/=]/.test(text) || /=[^=]/.test(text))
    throw new Error('rv32.image: code is not base64');
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pad);
  for (let i = 0, o = 0; i < text.length; i += 4) {
    const n =
      (ALPHABET.indexOf(text[i]) << 18) |
      (ALPHABET.indexOf(text[i + 1]) << 12) |
      ((ALPHABET.indexOf(text[i + 2]) & 63) << 6) |
      (ALPHABET.indexOf(text[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const codeCache = new WeakMap<object, Uint8Array>();
/** The code bytes of an image (decoded once per immutable value). Callers must not write to them. */
export function codeBytes(img: Rv32Image): Uint8Array {
  let b = codeCache.get(img);
  if (!b) codeCache.set(img, (b = fromBase64(img.code)));
  return b;
}

export const insnId = (fn: string, offset: number, entry: number): string =>
  `insn:${fn}+0x${(offset - entry).toString(16)}`;

// ---------- validation ----------
class ImageError extends Error {
  constructor(message: string) {
    super(`rv32.image: ${message}`);
  }
}
const need = (cond: unknown, message: string): void => {
  if (!cond) throw new ImageError(message);
};
const isWord = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) < 2 ** 32;

/**
 * The image is self-consistent: functions are laid out contiguously in `fnOrder`, every instruction sits at its
 * address in its function, its word is the word in `code`, its text is what the disassembler reads there, and its
 * targets and callees exist.
 */
export function validateImage(value: unknown): asserts value is Rv32Image {
  const v = value as Rv32Image;
  need(v && typeof v === 'object' && v.formatVersion === 1, 'formatVersion 1 required');
  need(typeof v.program === 'string' && v.program.length > 0, 'program name required');
  need(
    v.source === null ||
      (typeof v.source === 'object' &&
        typeof v.source.artifact === 'string' &&
        typeof v.source.revision === 'string'),
    'source is null or { artifact, revision }',
  );
  if (v.options !== null) {
    need(v.options && typeof v.options === 'object', 'options is null or the backend options');
    for (const k of Object.keys(backendDefaults)) need(k in v.options, `options.${k} missing`);
    for (const k of Object.keys(v.options)) need(k in backendDefaults, `unknown option ${k}`);
  }
  need(Number.isInteger(v.bytes) && v.bytes >= 0 && v.bytes % 4 === 0, 'bytes is a multiple of 4');
  need(typeof v.code === 'string', 'code is a base64 string');
  const code = fromBase64(v.code);
  need(code.length === v.bytes, `code has ${code.length} bytes, not ${v.bytes}`);
  const view = new DataView(code.buffer, code.byteOffset, code.byteLength);
  need(
    v.entries && v.fns && typeof v.entries === 'object' && typeof v.fns === 'object',
    'entries and fns required',
  );
  need(
    Array.isArray(v.fnOrder) &&
      v.fnOrder.length === Object.keys(v.fns).length &&
      v.fnOrder.length === Object.keys(v.entries).length &&
      new Set(v.fnOrder).size === v.fnOrder.length &&
      v.fnOrder.every(n => v.fns[n] && v.entries[n] !== undefined),
    'fnOrder must list every function once',
  );
  let at = 0;
  const owner: string[] = [];
  for (const name of v.fnOrder) {
    const f = v.fns[name];
    need(f.name === name && f.entry === v.entries[name], `function ${name}: entry disagrees with entries`);
    need(f.entry === at, `function ${name} starts at ${f.entry}, not ${at}`);
    need(Number.isInteger(f.insns) && f.bytes === 4 * f.insns, `function ${name}: bytes is 4 * insns`);
    if (f.sig !== undefined) {
      const classes = (xs: unknown) => Array.isArray(xs) && xs.every(t => t === 'i32' || t === 'f32');
      need(
        f.sig &&
          classes(f.sig.params) &&
          (f.sig.result === 'i32' || f.sig.result === 'f32') &&
          (f.sig.results === undefined || classes(f.sig.results)),
        `function ${name}: sig is { params, result, results? } of 'i32' and 'f32'`,
      );
    }
    for (let i = 0; i < f.insns; i++) owner.push(name);
    at += f.bytes;
  }
  need(at === v.bytes, `functions cover ${at} bytes of ${v.bytes}`);
  need(Array.isArray(v.insns) && v.insns.length === v.bytes / 4, 'one instruction record per word');
  v.insns.forEach((m, i) => {
    const where = `instruction ${i}`;
    need(m.offset === 4 * i, `${where}: offset ${m.offset}, expected ${4 * i}`);
    need(m.fn === owner[i], `${where}: in ${m.fn}, but the address is in ${owner[i]}`);
    need(m.id === insnId(m.fn, m.offset, v.entries[m.fn]), `${where}: id ${m.id}`);
    need(typeof m.op === 'string' && m.op.length > 0, `${where}: op required`);
    need(isWord(m.word) && m.word === view.getUint32(m.offset, true), `${where}: word differs from code`);
    need(m.text === decode(m.word, m.offset).text, `${where}: text is not the disassembly of its word`);
    need(typeof m.sym === 'string', `${where}: sym required`);
    need(
      Array.isArray(m.covers) && m.covers.every(c => typeof c === 'string' && c.length > 0),
      `${where}: covers is a list of ids`,
    );
    if (m.target !== undefined)
      need(
        Number.isInteger(m.target) && m.target >= 0 && m.target < v.bytes && m.target % 4 === 0,
        `${where}: target ${m.target} is not an instruction address`,
      );
    if (m.callee !== undefined) need(v.entries[m.callee] !== undefined, `${where}: no function ${m.callee}`);
  });
}

export const ImageIR = defineIR<Rv32Image>({
  id: 'rv32.image',
  version: '1',
  description: 'An RV32IM image whose instructions record the typed.blocks values and statements they cover',
  validate: validateImage,
});

// ---------- the v6 projection ----------
const omitUndefined = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));

export function imageEntities(v: Rv32Image): IREntity[] {
  const out: IREntity[] = [];
  for (const name of v.fnOrder) {
    const { name: _n, ...rest } = v.fns[name];
    out.push({ id: `fn:${name}`, kind: 'fn', attributes: { name, ...rest } });
  }
  for (const m of v.insns) {
    const { id, op, ...rest } = m;
    out.push({ id, kind: `insn.${op}`, attributes: omitUndefined(rest) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const entityIndex = new WeakMap<object, Map<string, IREntity>>();
/** One entity by id, from an index built once per immutable value (projection resolves every entity). */
export function resolveImageEntity(v: Rv32Image, id: string): IREntity | undefined {
  let index = entityIndex.get(v);
  if (!index) entityIndex.set(v, (index = new Map(imageEntities(v).map(e => [e.id, e]))));
  return index.get(id);
}

export function imageRelations(v: Rv32Image): IRRelation[] {
  const out: IRRelation[] = [];
  const counter = new Map<string, number>();
  for (const m of v.insns) {
    const i = counter.get(m.fn) ?? 0;
    counter.set(m.fn, i + 1);
    out.push({
      id: `contains:fn:${m.fn}:${i}`,
      kind: 'contains',
      category: 'containment',
      from: `fn:${m.fn}`,
      to: m.id,
      order: i,
    });
    if (m.target !== undefined)
      out.push({
        id: `jump:${m.id}`,
        kind: 'jump',
        category: 'control',
        from: m.id,
        to: v.insns[m.target / 4].id,
      });
    if (m.callee !== undefined)
      out.push({ id: `calls:${m.id}`, kind: 'calls', category: 'control', from: m.id, to: `fn:${m.callee}` });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export const imageAdapter = defineAdapter<Rv32Image>({
  id: 'adapter.rv32-image',
  version: '1',
  kind: ImageIR.id,
  schemaVersion: ImageIR.version,
  description: 'Functions and their instructions, with branch, jump and call edges; covers as attributes',
  relationKinds: { contains: 'containment', jump: 'control', calls: 'control' },
  entities: imageEntities,
  resolve: resolveImageEntity,
  relations: imageRelations,
  roots: v => v.fnOrder.map(n => `fn:${n}`),
  describe: (v, id) => {
    const m = v.insns.find(x => x.id === id);
    if (m) return { label: m.text, ...(m.why ? { detail: m.why } : {}) };
    const f = v.fns[id.replace(/^fn:/, '')];
    return f
      ? { label: `${f.name}: ${f.bytes} bytes`, stats: { bytes: f.bytes, insns: f.insns } }
      : { label: id };
  },
  validate: validateImage,
  serialize: v => JSON.stringify(v),
  deserialize: s => {
    const v = JSON.parse(s);
    validateImage(v);
    return v;
  },
});

/**
 * The v6 correspondence from a typed.blocks revision to an image lowered from it. Its universes are every entity
 * of both projections, so it composes with pass correspondences (r0 -> rN -> image). Entries:
 *   - one `covered-by` entry per covered source entity, to every instruction that lists it in `covers`;
 *   - `retained` from each source function to the image function of the same name;
 *   - everything else as `makeCorrespondence` completes it: source entities no instruction covers (blocks, locals,
 *     front-end ops, constants folded into immediates, local reads) as `removed`, and instructions that cover
 *     nothing (parameter copies, zeroed locals) as `inserted`.
 */
export function imageCorrespondence(
  blocks: Artifact<TypedBlocks>,
  image: Artifact<Rv32Image>,
): EntityCorrespondence {
  const src = image.value.source;
  if (!src || src.revision !== blocks.revision)
    fail(
      'wrongSource',
      `${image.id} was lowered from ${src ? src.artifact + '@' + src.revision.slice(0, 12) : 'no typed.blocks revision'}, not ${blocks.id}@${blocks.revision.slice(0, 12)}`,
    );
  const source = blocksEntities(blocks.value).map(e => e.id),
    target = imageEntities(image.value).map(e => e.id);
  const sourceSet = new Set(source);
  const covering = new Map<string, string[]>();
  for (const m of image.value.insns)
    for (const c of m.covers) {
      if (!sourceSet.has(c)) fail('wrongSource', `${m.id} covers ${c}, which ${blocks.id} does not contain`);
      covering.set(c, [...(covering.get(c) ?? []), m.id]);
    }
  const entries: CorrespondenceEntry[] = [...covering].map(([from, to]) => ({
    from: [from],
    to,
    relation: 'covered-by',
  }));
  for (const name of image.value.fnOrder)
    if (sourceSet.has(`fn:${name}`))
      entries.push({ from: [`fn:${name}`], to: [`fn:${name}`], relation: 'retained' });
  return makeCorrespondence(
    { artifact: blocks.id, revision: blocks.revision },
    { artifact: image.id, revision: image.revision },
    source,
    target,
    entries,
  );
}
