/**
 * Compiling a typed.blocks revision to an RV32 image: per function, instruction selection, linear-scan
 * allocation, rewriting onto physical registers with spill code, and a frame; then functions laid out in source
 * order, labels resolved, and every instruction encoded with every entry known. A port of Compiler Workbench's
 * backend.js `finish` and `compileAt`, producing the native value of `rv32.image` instead of store entities.
 */
import type { Artifact } from '../../framework/core/types.js';
import type { DataflowResult } from '../../framework/dataflow/analysis.js';
import { createIRArtifact } from '../../framework/ir/adapters.js';
import type { EntityCorrespondence } from '../../framework/ir/types.js';
import { livenessAnalysis, liveView, rangesAnalysis, rangeView } from '../analyses.js';
import { storeOf } from '../ir.js';
import type { Store, TypedBlocks, WorkFn } from '../model.js';
import { fail } from './errors.js';
import { CALLEE, RA, REGS, SP, T5, T6, ZERO, decode, encodeOne, type MInsn } from './encode.js';
import {
  imageAdapter,
  imageCorrespondence,
  insnId,
  toBase64,
  type ImageFn,
  type ImageInsn,
  type Rv32Image,
} from './image.js';
import { checkBackendOptions, type BackendOptions, type BackendOptionsInput } from './options.js';
import { allocate, type Allocation } from './regalloc.js';
import { select, type Selection } from './select.js';

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
 * before each use and stored from t5 after each definition. The frame holds the spill slots at the bottom and the
 * saved registers at the top, rounded up to 16 bytes; jumps to the label that follows are removed, a return with
 * no frame to pop becomes `ret`, and an exit nobody reaches is dropped.
 */
export function finish(f: WorkFn, code: readonly MInsn[], alloc: Allocation, leaf: boolean): Finished {
  const { assign, spilled } = alloc;
  const slots = new Map([...spilled].map((r, i) => [r, 4 * i]));
  const usedCallee = [...new Set([...assign.values()].filter(r => CALLEE.includes(r)))].sort((a, b) => a - b);
  const saved = (leaf ? [] : [RA]).concat(usedCallee);
  const frame = (slots.size * 4 + saved.length * 4 + 15) & ~15;
  if (frame > 2032) fail('frameTooLarge', `${f.name}: a frame of ${frame} bytes does not fit 12-bit offsets`);
  const saveAt = new Map(saved.map((r, i) => [r, frame - 4 - 4 * i]));
  const out: MInsn[] = [];
  const phys = (r: number | undefined, scratch: number, m: MInsn): number | undefined => {
    if (r === undefined || r < 64) return r;
    if (spilled.has(r)) {
      out.push({ op: 'lw', rd: scratch, rs1: SP, imm: slots.get(r)!, covers: m.covers, spill: 'reload' });
      return scratch;
    }
    return assign.get(r);
  };
  const store = (r: number, m: MInsn): MInsn => ({
    op: 'sw',
    rs1: SP,
    rs2: T5,
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
            op: 'sw',
            rs1: SP,
            rs2: r,
            imm: saveAt.get(r)!,
            covers: [f.id],
            note: 'save ' + REGS[r],
          });
      }
      continue;
    }
    const n: MInsn = { ...m };
    n.rs1 = phys(m.rs1, T5, m);
    n.rs2 = phys(m.rs2, T6, m);
    let spillDef: number | null = null;
    if (m.rd !== undefined && m.rd >= 64) {
      if (spilled.has(m.rd)) {
        spillDef = m.rd;
        n.rd = T5;
      } else n.rd = assign.get(m.rd);
    }
    if (n.mv && n.rd === n.rs1) {
      // coalesced; a spilled destination still needs its store
      if (spillDef !== null) out.push(store(spillDef, m));
      continue;
    }
    if (n.rd === undefined && m.rd !== undefined) n.rd = ZERO; // dead definition with no register
    out.push(n);
    if (spillDef !== null) out.push(store(spillDef, m));
  }
  // the exit sequence, and jumps to the next label removed
  out.push({ op: 'label', name: 'exit', covers: [] });
  for (const r of saved)
    out.push({ op: 'lw', rd: r, rs1: SP, imm: saveAt.get(r)!, covers: [f.id], note: 'restore ' + REGS[r] });
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
    code: final,
    frame,
    saved,
    spills: slots.size,
    regs: [...new Set(assign.values())].sort((a, b) => a - b),
  };
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
}

function compileFunction(
  st: Store,
  f: WorkFn,
  o: BackendOptions,
  liveness: DataflowResult,
  ranges: DataflowResult | null,
): FnCompilation {
  const sel = select({
    st,
    f,
    o,
    live: liveView(liveness, st, f.name),
    ranges: ranges ? rangeView(ranges, st, f.name) : null,
  });
  const leaf = !sel.code.some(m => m.op === 'call');
  const alloc = allocate(sel.code, sel.hints, o, leaf);
  const fin = finish(f, sel.code, alloc, leaf);
  return { f, sel, alloc, fin, leaf };
}

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

/**
 * Lower a typed.blocks artifact to an `rv32.image` artifact (id `img:PROGRAM` unless given), with the
 * correspondence from the program's entities to the image's instructions.
 */
export function lowerToImage(
  blocks: Artifact<TypedBlocks>,
  options: BackendOptionsInput = {},
  opts: BackendFacts & { readonly id?: string } = {},
): Lowered {
  const image = createIRArtifact(
    imageAdapter,
    opts.id ?? `img:${blocks.value.program}`,
    compileImage(blocks, options, opts),
  );
  return { image, correspondence: imageCorrespondence(blocks, image) };
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
  const name = (r: number | undefined) => (r === undefined ? '' : r < 64 ? REGS[r] : `v${r - 64}`);
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
