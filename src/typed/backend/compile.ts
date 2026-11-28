/**
 * Compiling a typed.blocks revision to an RV32 image: per function, instruction selection, linear-scan
 * allocation, rewriting onto physical registers with spill code, and a frame; then functions laid out in source
 * order, labels resolved, and every instruction encoded with every entry known. A port of Compiler Workbench's
 * backend.js `finish` and `compileAt`, producing the native value of `rv32.image` instead of store entities.
 */
import type { AnalysisManager } from '../../framework/contracts/analysis-manager.js';
import type { Artifact } from '../../framework/core/types.js';
import type { DataflowResult } from '../../framework/dataflow/analysis.js';
import type { EntityCorrespondence, IRStore } from '../../framework/ir/index.js';
import {
  applyTransformation,
  applyTransformationSync,
  transformation,
  type CrossTransformation,
  type TransformationResult,
} from '../../framework/passes/transformation.js';
import { livenessAnalysis, liveView, rangesAnalysis, rangeView } from '../analyses.js';
import { BlocksIR, blocksAdapter, storeOf } from '../ir.js';
import { typeClass, type Store, type TypedBlocks, type WorkFn } from '../model.js';
import { fail } from './errors.js';
import {
  CALLEE,
  FT10,
  FT11,
  F_CALLEE,
  RA,
  REGS,
  SP,
  T5,
  T6,
  ZERO,
  INVERT,
  decode,
  encodeOne,
  fits12,
  isBranch,
  physClass,
  type MInsn,
} from './encode.js';
import { needsConvention } from '../ilp32f.js';
import {
  ImageIR,
  coverEntries,
  imageAdapter,
  insnId,
  toBase64,
  type ImageFn,
  type ImageSig,
  type ImageInsn,
  type Rv32Image,
} from './image.js';
import { checkBackendOptions, type BackendOptions, type BackendOptionsInput } from './options.js';
import { allocate, type Allocation } from './regalloc.js';
import { select, type Selection } from './select.js';
import { coalesceCopies } from './coalesce.js';
import { chooseVariant, type VariantChoice, type VariantHooks } from './variants.js';
import { loweringContract, type ImageCheckParams } from './run.js';

export interface Finished {
  /** Physical code with labels, frame, spill code and the exit sequence. */
  readonly code: MInsn[];
  readonly frame: number;
  /** Saved registers: ra (unless a leaf), then the callee-saved registers used, ascending. */
  readonly saved: readonly number[];
  readonly spills: number;
  readonly regs: readonly number[];
}

/**
 * Rewrite virtual registers onto the allocation. A spilled value is loaded into t5 (first operand) or t6 (second)
 * before each use and stored from t5 after each definition; an f32 value likewise through ft10 and ft11 with flw
 * and fsw. The frame holds, from the bottom: the outgoing stack words of the calls (ilp32f), the frame array area,
 * the spill slots, and the saved registers at the top, rounded up to 16 bytes. An access at the caller's sp (an
 * incoming stack argument, a result leaf the callee writes) gets the frame size added to its offset. Jumps to the
 * label that follows are removed, a return with no frame to pop becomes `ret`, and an exit nobody reaches is dropped.
 */
export function finish(
  f: WorkFn,
  code: readonly MInsn[],
  alloc: Allocation,
  leaf: boolean,
  layout: { readonly fregs?: ReadonlySet<number>; readonly outgoing?: number; readonly arrays?: number } = {},
): Finished {
  const { assign, spilled } = alloc;
  const fregs = layout.fregs ?? new Set<number>();
  const slotBase = 4 * (layout.outgoing ?? 0) + (layout.arrays ?? 0);
  const slots = new Map([...spilled].map((r, i) => [r, slotBase + 4 * i]));
  const usedCallee = [
    ...new Set([...assign.values()].filter(r => CALLEE.includes(r) || F_CALLEE.includes(r))),
  ].sort((a, b) => a - b);
  const saved = (leaf ? [] : [RA]).concat(usedCallee);
  const frame = (slotBase + slots.size * 4 + saved.length * 4 + 15) & ~15;
  if (frame > 2032) fail('frameTooLarge', `${f.name}: a frame of ${frame} bytes does not fit 12-bit offsets`);
  const saveAt = new Map(saved.map((r, i) => [r, frame - 4 - 4 * i]));
  const out: MInsn[] = [];
  const isFloat = (r: number) => (r >= 64 ? fregs.has(r) : physClass(r) === 'f');
  const load = (r: number) => (isFloat(r) ? 'flw' : 'lw'),
    storeOp = (r: number) => (isFloat(r) ? 'fsw' : 'sw');
  const phys = (r: number | undefined, scratch: number, m: MInsn): number | undefined => {
    if (r === undefined || r < 64) return r;
    if (spilled.has(r)) {
      out.push({ op: load(r), rd: scratch, rs1: SP, imm: slots.get(r)!, covers: m.covers, spill: 'reload' });
      return scratch;
    }
    return assign.get(r);
  };
  const store = (r: number, m: MInsn, from = isFloat(r) ? FT10 : T5): MInsn => ({
    op: storeOp(r),
    rs1: SP,
    rs2: from,
    imm: slots.get(r)!,
    covers: m.covers,
    spill: 'store',
  });
  for (const m of code) {
    if (m.op === 'label') {
      out.push(m);
      if (m.name === 'entry' && frame) {
        out.push({ op: 'addi', rd: SP, rs1: SP, imm: -frame, covers: [f.id], note: 'frame' });
        for (const r of saved)
          out.push({
            op: storeOp(r),
            rs1: SP,
            rs2: r,
            imm: saveAt.get(r)!,
            covers: [f.id],
            note: 'save ' + REGS[r],
          });
      }
      continue;
    }
    // an f32 copy with a spilled side is one flw or fsw (or both, through ft10)
    if (m.mv && m.rd !== undefined && isFloat(m.rd) && m.rs1 !== undefined) {
      const from = spilled.has(m.rs1) ? m.rs1 : null,
        to = spilled.has(m.rd) ? m.rd : null;
      if (from !== null || to !== null) {
        if (from !== null && to !== null) {
          if (from !== to) {
            out.push({
              op: 'flw',
              rd: FT10,
              rs1: SP,
              imm: slots.get(from)!,
              covers: m.covers,
              spill: 'reload',
            });
            out.push(store(to, m));
          }
        } else if (from !== null) {
          const rd = m.rd < 64 ? m.rd : assign.get(m.rd)!;
          out.push({ op: 'flw', rd, rs1: SP, imm: slots.get(from)!, covers: m.covers, spill: 'reload' });
        } else out.push(store(to!, m, m.rs1 < 64 ? m.rs1 : assign.get(m.rs1)!));
        continue;
      }
    }
    const n: MInsn = { ...m };
    const fl = (r: number | undefined) => r !== undefined && isFloat(r);
    n.rs1 = phys(m.rs1, fl(m.rs1) ? FT10 : T5, m);
    // the same f register read twice (fsgnj.s rd, v, v) is reloaded once
    n.rs2 = fl(m.rs2) && m.rs2 === m.rs1 ? n.rs1 : phys(m.rs2, fl(m.rs2) ? FT11 : T6, m);
    let spillDef: number | null = null;
    if (m.rd !== undefined && m.rd >= 64) {
      if (spilled.has(m.rd)) {
        spillDef = m.rd;
        n.rd = fl(m.rd) ? FT10 : T5;
      } else n.rd = assign.get(m.rd);
    }
    if (n.mv && n.rd === n.rs1) {
      // coalesced; a spilled destination still needs its store
      if (spillDef !== null) out.push(store(spillDef, m));
      continue;
    }
    if (n.rd === undefined && m.rd !== undefined) {
      if (fl(m.rd)) fail('internal', `${f.name}: f register v${m.rd - 64} has no register and no slot`);
      n.rd = ZERO; // dead definition with no register
    }
    if (m.caller) {
      // at the caller's sp: past this function's frame; beyond 12 bits through t6 (loads) or t5 (stores) = sp + frame
      const at = frame + m.imm!;
      if (fits12(at)) n.imm = at;
      else {
        const base = n.op === 'sw' || n.op === 'fsw' ? T5 : T6;
        out.push({ op: 'addi', rd: base, rs1: SP, imm: frame, covers: m.covers, note: "the caller's sp" });
        n.rs1 = base;
      }
    }
    out.push(n);
    if (spillDef !== null) out.push(store(spillDef, m));
  }
  // the exit sequence, and jumps to the next label removed
  out.push({ op: 'label', name: 'exit', covers: [] });
  for (const r of saved)
    out.push({
      op: load(r),
      rd: r,
      rs1: SP,
      imm: saveAt.get(r)!,
      covers: [f.id],
      note: 'restore ' + REGS[r],
    });
  if (frame) out.push({ op: 'addi', rd: SP, rs1: SP, imm: frame, covers: [f.id], note: 'frame' });
  out.push({ op: 'ret', covers: [f.id] });
  const final: MInsn[] = [];
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    const target = m.op === 'jexit' ? 'exit' : m.op === 'j' ? m.target : null;
    if (target) {
      let k = i + 1,
        falls = false;
      while (k < out.length && out[k].op === 'label') {
        if (out[k].name === target) falls = true;
        k++;
      }
      if (falls) continue;
      if (target === 'exit' && !frame) {
        final.push({ ...m, op: 'ret', note: 'return (no frame to pop)' });
        continue;
      }
      final.push({ ...m, op: 'j', target });
      continue;
    }
    final.push(m);
  }
  // an exit nobody reaches (every return already ended in ret) is dropped
  const exitAt = final.findIndex(m => m.op === 'label' && m.name === 'exit');
  const before = final[exitAt - 1]; // a label just before exit could be a jump target that falls into it
  if (!final.some(m => m.target === 'exit') && before && ['ret', 'j', 'ebreak'].includes(before.op))
    final.length = exitAt;
  return {
    code: relaxBranches(final),
    frame,
    saved,
    spills: slots.size,
    regs: [...new Set(assign.values())].sort((a, b) => a - b),
  };
}

/**
 * Branch relaxation: a conditional branch reaches ±4 KiB; one whose target is farther becomes the inverted branch
 * over a `jal zero, target` (±1 MiB). Repeated until every branch fits, since each expansion moves code.
 */
export function relaxBranches(code: readonly MInsn[]): MInsn[] {
  let out = [...code],
    far = 0;
  for (;;) {
    const at = new Map<string, number>(),
      pcs: number[] = [];
    let pc = 0;
    for (const m of out)
      if (m.op === 'label') at.set(m.name!, pc);
      else {
        pcs.push(pc);
        pc += 4;
      }
    const next: MInsn[] = [];
    let k = 0,
      changed = false;
    for (const m of out) {
      if (m.op === 'label') {
        next.push(m);
        continue;
      }
      const here = pcs[k++];
      // an unknown target is left for the encoder to report
      const t = isBranch(m.op) ? at.get(m.target!) : undefined;
      const d = t === undefined ? 0 : t - here;
      if (d >= -4096 && d <= 4094) {
        next.push(m);
        continue;
      }
      const over = `far${far++}`;
      next.push(
        { ...m, op: INVERT[m.op], target: over },
        { op: 'j', target: m.target, covers: m.covers, note: 'a branch target beyond ±4 KiB' },
        { op: 'label', name: over, covers: [] },
      );
      changed = true;
    }
    out = next;
    if (!changed) return out;
  }
}

/** Facts a caller may supply (e.g. from an AnalysisManager); computed from the artifact otherwise. */
export interface BackendFacts {
  readonly liveness?: DataflowResult;
  readonly ranges?: DataflowResult;
}

export interface FnCompilation {
  readonly f: WorkFn;
  readonly sel: Selection;
  readonly alloc: Allocation;
  readonly fin: Finished;
  readonly leaf: boolean;
  /** With an IRWB-003 option: which variant the estimate chose (variants.ts). */
  readonly choice?: VariantChoice;
}

function compileFunction(
  st: Store,
  f: WorkFn,
  o: BackendOptions,
  liveness: DataflowResult,
  ranges: DataflowResult | null,
): FnCompilation {
  const once = (opts: BackendOptions, hooks: VariantHooks): FnCompilation => {
    let sel = select({
      st,
      f,
      o: opts,
      live: liveView(liveness, st, f.name),
      ranges: ranges ? rangeView(ranges, st, f.name) : null,
      homes: hooks.homes,
      onConst: hooks.onConst,
    });
    if (hooks.coalesce) sel = coalesceCopies(sel, hooks.coalesce).sel;
    const leaf = !sel.code.some(m => m.op === 'call');
    const alloc = allocate(sel.code, sel.hints, opts, leaf, sel.fregs);
    const fin = finish(f, sel.code, alloc, leaf, sel);
    return { f, sel, alloc, fin, leaf };
  };
  // the default backend compiles once, as before IRWB-003; its options choose per function by the estimate
  if (!o.chains && !o.coalesce && !o.homes) return once(o, {});
  const { best, choice } = chooseVariant(st, f, o, once);
  return { ...best, choice };
}

/** A function's signature by type class (i32 or f32), as an image records it. */
const sigOf = (f: WorkFn): ImageSig => ({
  params: f.params.map(typeClass),
  result: typeClass(f.result),
  ...(f.results ? { results: f.results.map(typeClass) } : {}),
});

const factsFor = (blocks: Artifact<TypedBlocks>, o: BackendOptions, facts: BackendFacts) => ({
  liveness: facts.liveness ?? livenessAnalysis.solveArtifact(blocks),
  ranges: o.useRanges ? (facts.ranges ?? rangesAnalysis.solveArtifact(blocks)) : null,
});

/** The native image of a typed.blocks revision. */
export function compileImage(
  blocks: Artifact<TypedBlocks>,
  options: BackendOptionsInput = {},
  facts: BackendFacts = {},
): Rv32Image {
  const o = checkBackendOptions(options);
  const st = storeOf(blocks.value);
  const { liveness, ranges } = factsFor(blocks, o, facts);
  const perFn = [...st.fns.values()].map(f => compileFunction(st, f, o, liveness, ranges));
  // lay out functions in order, then encode with every label known
  let pc = 0;
  const entries: Record<string, number> = {},
    labelAts = new Map<string, Map<string, number>>(),
    pcs = new Map<string, number[]>();
  for (const x of perFn) {
    entries[x.f.name] = pc;
    const at = new Map<string, number>(),
      list: number[] = [];
    for (const m of x.fin.code) {
      if (m.op === 'label') at.set(m.name!, pc);
      else {
        list.push(pc);
        pc += 4;
      }
    }
    labelAts.set(x.f.name, at);
    pcs.set(x.f.name, list);
  }
  const bytes = new Uint8Array(pc),
    view = new DataView(bytes.buffer);
  const insns: ImageInsn[] = [],
    fns: Record<string, ImageFn> = {};
  for (const x of perFn) {
    const name = x.f.name,
      at = labelAts.get(name)!,
      list = pcs.get(name)!;
    let count = 0;
    for (const m of x.fin.code) {
      if (m.op === 'label') continue;
      const mpc = list[count];
      const word = encodeOne(m, mpc, at, entries) >>> 0;
      view.setUint32(mpc, word, true);
      const covers = m.covers.filter(c => c && st.has(c));
      const why = m.spill
        ? `spill ${m.spill}`
        : m.note || m.why || (m.mv ? 'copy' : m.zero !== undefined ? 'zero a local' : undefined);
      const text = decode(word, mpc).text;
      // the same instruction with its target named instead of addressed, so diffs line up
      const sym =
        m.op === 'call'
          ? `call ${m.callee}`
          : m.target
            ? text.replace(/0x[0-9a-f]+$/, m.target.replace(/^bb:[^.]+/, 'bb'))
            : text;
      insns.push({
        id: insnId(name, mpc, entries[name]),
        fn: name,
        offset: mpc,
        op: m.op,
        word,
        text,
        sym,
        covers,
        ...(why ? { why } : {}),
        ...(m.target ? { target: at.get(m.target)!, label: m.target } : {}),
        ...(m.op === 'call' ? { callee: m.callee! } : {}),
      });
      count++;
    }
    fns[name] = {
      name,
      entry: entries[name],
      bytes: count * 4,
      insns: count,
      frame: x.fin.frame,
      saved: x.fin.saved.map(r => REGS[r]),
      spills: x.fin.spills,
      regs: x.fin.regs.map(r => REGS[r]),
      vregs: x.sel.vregs,
      leaf: x.leaf,
      // the calling convention, for functions a caller cannot call as integers in a0-a7 with a result in a0
      ...(needsConvention(sigOf(x.f)) ? { sig: sigOf(x.f) } : {}),
    };
  }
  return {
    formatVersion: 1,
    program: blocks.value.program,
    source: { artifact: blocks.id, revision: blocks.revision },
    options: o,
    bytes: pc,
    code: toBase64(bytes),
    entries,
    fnOrder: perFn.map(x => x.f.name),
    fns,
    insns,
  };
}

export interface Lowered {
  readonly image: Artifact<Rv32Image>;
  /** typed.blocks entities -> image entities (see `imageCorrespondence`). */
  readonly correspondence: EntityCorrespondence;
}

/** The parameters of one lowering: the backend options, and facts the caller already holds. */
export interface LoweringParams {
  readonly options?: BackendOptionsInput;
  readonly facts?: BackendFacts;
}
const FACTS = { liveness: livenessAnalysis, ranges: rangesAnalysis };
type Lowering<N extends {} | typeof FACTS> = CrossTransformation<TypedBlocks, Rv32Image, N, LoweringParams>;
const lowerings = new Map<string, Lowering<{}> | Lowering<typeof FACTS>>();
/**
 * IRWB-061: the lowering as a transformation, `typed.lower-rv32`, from `typed.blocks` to `rv32.image`. Its relation
 * is exact; its `ensures` is `loweringContract(check)`, whose condition is `rv32.image-agrees`; its correspondence
 * is the image's `covers` (`coverEntries`), completed by the runner. With `facts: 'needs'` liveness and ranges are
 * declared analyses, computed and cached by the application's analysis manager; with `'own'` (an application
 * without a manager) `compileImage` solves them itself, or takes them from the parameters.
 */
export function imageLowering(check?: ImageCheckParams, facts?: 'own'): Lowering<{}>;
export function imageLowering(check: ImageCheckParams | undefined, facts: 'needs'): Lowering<typeof FACTS>;
export function imageLowering(
  check: ImageCheckParams = {},
  facts: 'own' | 'needs' = 'own',
): Lowering<{}> | Lowering<typeof FACTS> {
  const contract = loweringContract(check),
    key = `${facts} ${contract.version}`;
  let t = lowerings.get(key);
  if (!t) {
    t = transformation<TypedBlocks, Rv32Image, {} | typeof FACTS, LoweringParams>({
      id: 'typed.lower-rv32',
      version: '1',
      description:
        'Compile a typed.blocks revision to an RV32 image whose instructions record what they cover',
      from: { ir: BlocksIR, adapter: blocksAdapter },
      to: { ir: ImageIR, adapter: imageAdapter },
      needs: facts === 'needs' ? FACTS : {},
      relation: 'exact',
      prepare({ before, params, facts: solved }) {
        const output = compileImage(before, params?.options, { ...params?.facts, ...solved });
        return {
          output,
          outputId: `img:${before.value.program}`,
          correspondence: coverEntries(before, output),
          edits: output.insns.length,
        };
      },
      bind: ({ before, candidate }) => ({ inputs: { program: before }, outputs: { image: candidate } }),
      obligations: { ensures: [contract] },
    });
    lowerings.set(key, t);
  }
  return t;
}

const lowered = (r: TransformationResult<TypedBlocks, Rv32Image>): Lowered => ({
  image: r.artifact,
  correspondence: r.correspondence!,
});
/**
 * Lower a typed.blocks artifact to an `rv32.image` artifact (id `img:PROGRAM` unless given), with the
 * correspondence from the program's entities to the image's instructions.
 *
 * IRWB-061: a pending application of `typed.lower-rv32`. The image is the transformation's output and its
 * `rv32.image-agrees` obligation is recorded as owed, not run; `lowerImageChecked` is the application that runs it.
 */
export function lowerToImage(
  blocks: Artifact<TypedBlocks>,
  options: BackendOptionsInput = {},
  opts: BackendFacts & { readonly id?: string } = {},
): Lowered {
  const { id, ...facts } = opts;
  return lowered(
    applyTransformationSync(imageLowering(), blocks, {
      params: { options, facts },
      outputId: id,
      pending: { reason: 'lowerToImage: the image only; rv32.image-agrees is run by lowerImageChecked' },
    }),
  );
}

/**
 * The checked lowering: `typed.lower-rv32` with its `ensures` run on `check`'s generated cases. A disagreeing image
 * is rejected (`PassError('contractRejected')`, with the differential's counterexamples in the manager's record)
 * and nothing is published; an accepted one becomes the head of its lineage in `store`, with its evidence.
 */
export async function lowerImageChecked(
  blocks: Artifact<TypedBlocks>,
  options: BackendOptionsInput = {},
  opts: {
    readonly manager: AnalysisManager;
    readonly check?: ImageCheckParams;
    readonly store?: IRStore;
    readonly id?: string;
  },
): Promise<Lowered & { readonly result: TransformationResult<TypedBlocks, Rv32Image> }> {
  const result = await applyTransformation(imageLowering(opts.check, 'needs'), blocks, {
    manager: opts.manager,
    store: opts.store,
    params: { options },
    outputId: opts.id,
  });
  return { ...lowered(result), result };
}

/** IRWB-003: per function, which variant the estimate chose under these options (none for the defaults). */
export function variantChoices(
  blocks: Artifact<TypedBlocks>,
  options: BackendOptionsInput = {},
  facts: BackendFacts = {},
): Record<string, VariantChoice | null> {
  const o = checkBackendOptions(options),
    st = storeOf(blocks.value);
  const { liveness, ranges } = factsFor(blocks, o, facts);
  return Object.fromEntries(
    [...st.fns.values()].map(f => [f.name, compileFunction(st, f, o, liveness, ranges).choice ?? null]),
  );
}

export interface MachineStages {
  /** Selected code on virtual registers (`v0`, `v1`, ...) and the physical ones it names. */
  readonly selected: readonly string[];
  readonly intervals: readonly {
    readonly vreg: string;
    readonly start: number;
    readonly end: number;
    readonly crossesCall: boolean;
    readonly reg: string;
  }[];
  readonly spilled: readonly string[];
  readonly leaf: boolean;
}

/** The stages of one function, for teaching: selected code on virtual registers, intervals, allocation. */
export function machineCode(
  blocks: Artifact<TypedBlocks>,
  fname: string,
  options: BackendOptionsInput = {},
  facts: BackendFacts = {},
): MachineStages {
  const o = checkBackendOptions(options),
    st = storeOf(blocks.value);
  const { liveness, ranges } = factsFor(blocks, o, facts);
  const { sel, alloc, leaf } = compileFunction(st, st.fn(fname), o, liveness, ranges);
  const name = (r: number | undefined) =>
    r === undefined ? '' : r < 64 ? REGS[r] : sel.fregs.has(r) ? `vf${r - 64}` : `v${r - 64}`;
  const show = (m: MInsn) =>
    m.op === 'label'
      ? `${m.name}:`
      : `  ${m.op} ${[m.rd, m.rs1, m.rs2]
          .filter(r => r !== undefined)
          .map(name)
          .concat(
            m.imm !== undefined ? [String(m.imm)] : [],
            m.target ? [m.target] : [],
            m.callee ? [m.callee] : [],
          )
          .join(', ')}`;
  return {
    selected: sel.code.map(show),
    intervals: alloc.intervals.map(x => ({
      vreg: name(x.reg),
      start: x.start,
      end: x.end,
      crossesCall: x.crossesCall,
      reg: alloc.spilled.has(x.reg) ? 'spilled' : REGS[alloc.assign.get(x.reg)!],
    })),
    spilled: [...alloc.spilled].map(name),
    leaf,
  };
}
