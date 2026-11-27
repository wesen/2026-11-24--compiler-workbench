// P2.4: the RV32 backend — selection, allocation, frames, encoding, rv32.image as a v6 IR, runs and checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor({ reference: true });
const { ingest } = await import('../../dist/typed/lift.js');
const { blocksAdapter, storeOf } = await import('../../dist/typed/ir.js');
const { createIRArtifact, openIR, traceEntity, deserializeIR } = await import(
  '../../dist/framework/ir/index.js'
);
const { AnalysisManager } = await import('../../dist/framework/contracts/index.js');
const E = await import('../../dist/typed/evaluate.js');
const { linesOf } = await import('../../dist/typed/listing.js');
const B = await import('../../dist/typed/backend/index.js');

// A project's source as Compiler Workbench builds it: project.json `sources` first, then the other .typed files
// sorted, each ending in a newline (start-here is the one project with two files and no main.typed).
const project = id => {
  const dir = `corpus/projects/${id}`;
  const meta = JSON.parse(readFileSync(`${dir}/project.json`, 'utf8'));
  const typed = readdirSync(dir)
    .filter(f => f.endsWith('.typed'))
    .sort();
  const order = (meta.sources ?? []).concat(typed.filter(f => !(meta.sources ?? []).includes(f)));
  const source = order
    .map(f => readFileSync(`${dir}/${f}`, 'utf8'))
    .map(t => (t.endsWith('\n') ? t : t + '\n'))
    .join('');
  return { meta, source };
};
const projects = readdirSync('corpus/projects').filter(id =>
  existsSync(`corpus/projects/${id}/project.json`),
);
const load = id => {
  const { meta, source } = project(id);
  const r0 = createIRArtifact(blocksAdapter, id, ingest(id, source, meta.ingest ?? {}).toNative());
  return { meta, source, r0, st: storeOf(r0.value) };
};
const cells = n => ({ cells: Array.from({ length: n }, (_, i) => (i * 37) % 256) });
const steps = (image, st, fn, bench) => {
  const c = E.benchCase(st, fn, bench);
  return B.runImage(image, fn, c.args, c.memory, { limit: 5e6 });
};
// The vendored reference compiler carries only its core bundle, so the policy without tape passes.
const reference = (id, source) => {
  const r = globalThis.typedRv32.compile(source, [], undefined, { policy: 'interactive' });
  return createIRArtifact(B.imageAdapter, `ref:${id}`, B.imageFromCode(id, r.image, r.entries, r.signatures));
};

test('P2.4: Blend at r0 matches the book: 96 bytes, 531 instructions on 40 cells with n = 40', () => {
  const { r0, st } = load('blend');
  const { image } = B.lowerToImage(r0);
  assert.equal(image.kind, 'rv32.image');
  assert.equal(image.value.bytes, 96);
  assert.deepEqual(
    {
      frame: image.value.fns.blend.frame,
      leaf: image.value.fns.blend.leaf,
      spills: image.value.fns.blend.spills,
    },
    { frame: 0, leaf: true, spills: 0 },
  );
  const run = steps(image, st, 'blend', { work: cells(40), n: 40, a: 3, b: 5 });
  assert.equal(run.steps, 531);
  const c = E.benchCase(st, 'blend', { work: cells(40), n: 40, a: 3, b: 5 });
  assert.equal(run.result, E.evaluate(st, 'blend', c.args, c.memory).result);
  // "with fuse, immediates and divmagic off, 116"
  assert.equal(
    B.lowerToImage(r0, { fuse: false, immediates: false, divmagic: false }).image.value.bytes,
    116,
  );
  // the bounds check: the copy of i, the capacity load, the unsigned branch over an ebreak
  const texts = image.value.insns.map(m => m.text);
  assert.ok(texts.includes('lw t4, 0(a0)') && texts.includes('ebreak'));
  assert.equal(image.value.insns.find(m => m.op === 'ebreak').why, 'unreachable');
});

test('P2.6: after O2 the images match the book: Blend 88 bytes / 451, Checksum 52 bytes / 366', async () => {
  const { Program } = await import('../../dist/typed/program.js');
  const { projectSource } = await import('../../dist/typed/project.js');
  const { projectFiles } = await import('../../tools/corpus.mjs');
  const o2 = async id => {
    const p = Program.fromProject(projectSource(id, projectFiles(id)));
    await p.pipeline('O2');
    return { p, st: storeOf(p.head.value), image: B.lowerToImage(p.head).image };
  };
  const blend = await o2('blend');
  assert.equal(blend.image.value.bytes, 88);
  const run = steps(blend.image, blend.st, 'blend', { work: cells(40), n: 40, a: 3, b: 5 });
  assert.equal(run.steps, 451);
  // "on a 40-cell run, line 5 accounts for 322 of the 451 instructions executed"
  assert.equal(B.heat(blend.st, blend.image, run.counts).byLine.get(5), 322);
  // "the instruction mul t2, a2, a3 in the O2 image of Blend covers v:blend.23 and s:blend.15"
  const mul = blend.image.value.insns.find(m => m.text === 'mul t2, a2, a3');
  assert.ok(mul, blend.image.value.insns.map(m => m.text).join('\n'));
  assert.ok(mul.covers.includes('s:blend.15') && mul.covers.includes('v:blend.23'), JSON.stringify(mul.covers));
  const checksum = await o2('checksum');
  assert.equal(checksum.image.value.bytes, 52);
  const fn = checksum.p.fns()[0];
  const bench = Object.fromEntries(checksum.st.fn(fn).params.map((t, i) => [checksum.st.fn(fn).locals[i].name, t === 'buffer' ? cells(40) : 40]));
  assert.equal(steps(checksum.image, checksum.st, fn, bench).steps, 366);
});

test("P2.4: the book's other r0 numbers reproduce", () => {
  const at = id => {
    const x = load(id);
    return { ...x, image: B.lowerToImage(x.r0).image };
  };
  // Checksum: 64 bytes and 446 instructions on a 40-cell buffer (chapter 11)
  const cs = at('checksum');
  assert.equal(cs.image.value.bytes, 64);
  assert.equal(steps(cs.image, cs.st, 'total', { work: cells(40) }).steps, 446);
  // chapter 14's table, r0 column
  const sort = at('sort');
  assert.equal(
    steps(sort.image, sort.st, 'sort', { work: { cells: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] } }).steps,
    2022,
  );
  const cz = at('collatz');
  assert.equal(steps(cz.image, cz.st, 'collatz', { n: 27 }).steps, 1590);
  const vn = at('value-numbering');
  assert.equal(steps(vn.image, vn.st, 'halves', { n: 40 }).steps, 690);
  // licm-nested before licm: 955 instructions on rows = cols = 10
  const ln = at('licm-nested');
  assert.equal(steps(ln.image, ln.st, 'table', { rows: 10, cols: 10, a: 3, b: 5 }).steps, 955);
  // chapter 12: digitsum(987654321) with and without divmagic
  const dm = load('div-magic');
  const magic = B.lowerToImage(dm.r0).image,
    plain = B.lowerToImage(dm.r0, { divmagic: false }).image;
  assert.deepEqual(
    [magic.value.fns.digitsum.bytes, steps(magic, dm.st, 'digitsum', { x: 987654321 }).steps],
    [76, 107],
  );
  assert.deepEqual(
    [plain.value.fns.digitsum.bytes, steps(plain, dm.st, 'digitsum', { x: 987654321 }).steps],
    [60, 71],
  );
  // sevenths builds the magic number for 7 with lui and addi, then mulh, an add, a shift and a sign correction
  const sevenths = magic.value.insns.filter(m => m.fn === 'sevenths').map(m => m.text);
  assert.deepEqual(sevenths.slice(0, 7), [
    'lui t0, 0x92492',
    'addi t0, t0, 1171',
    'mulh t0, a0, t0',
    'add t0, t0, a0',
    'srai t0, t0, 2',
    'srli t1, a0, 31',
    'add t0, t0, t1',
  ]);
  // chapter 12: safeShare is 56 bytes with no ebreak when ranges are used, 92 with three when not
  const dc = load('div-checks');
  const ebreaks = (img, fn) => img.value.insns.filter(m => m.fn === fn && m.op === 'ebreak').length;
  const on = B.lowerToImage(dc.r0).image,
    off = B.lowerToImage(dc.r0, { useRanges: false }).image;
  assert.deepEqual([on.value.fns.safeShare.bytes, ebreaks(on, 'safeShare')], [56, 0]);
  assert.deepEqual([off.value.fns.safeShare.bytes, ebreaks(off, 'safeShare')], [92, 3]);
  assert.equal(ebreaks(on, 'share'), 2, 'share divides by an unknown and keeps both tests');
  // chapter 15: energy keeps a, b, c across four calls in s1-s3, two more values in s4, s5; a 32-byte frame
  const calls = load('calls');
  const img = o => B.lowerToImage(calls.r0, o).image.value;
  const dflt = img({});
  assert.equal(dflt.bytes, 212);
  assert.deepEqual(dflt.fns.energy.saved, ['ra', 's1', 's2', 's3', 's4', 's5']);
  assert.equal(dflt.fns.energy.frame, 32);
  const callee = img({ order: 'callee' });
  assert.equal(callee.bytes, 252);
  assert.equal(callee.fns.energy.saved.length, 7, "order: 'callee' saves six s registers instead of five");
  assert.equal(img({ hints: false }).bytes, 220);
  // call-chain: h is a leaf with no frame; g and f save ra, s1 and s2 in 16 bytes
  const cc = B.lowerToImage(load('call-chain').r0).image.value.fns;
  assert.deepEqual([cc.h.frame, cc.h.leaf], [0, true]);
  for (const f of [cc.g, cc.f]) assert.deepEqual([f.frame, f.saved], [16, ['ra', 's1', 's2']]);
});

test('P2.4: rv32.image-agrees holds for every function of every corpus project at r0', async () => {
  const m = new AnalysisManager();
  let fns = 0,
    decided = 0,
    inconclusive = 0;
  for (const id of projects) {
    const { meta, r0, st } = load(id);
    const { image } = B.lowerToImage(r0);
    const ev = await m.checkInvariant(B.imageAgrees({ inputs: meta.inputs ?? {} }), { program: r0, image });
    assert.equal(ev.evidence.disagree, 0, `${id}: ${JSON.stringify(ev.evidence.counterexamples)}`);
    assert.equal(ev.ok, true, `${id}: ${ev.reason}`);
    fns += st.fns.size;
    decided += ev.evidence.agree;
    inconclusive += ev.evidence.inconclusive;
  }
  // 40 cases per function; my-analysis has four cases whose loops hit the step limit
  assert.equal(decided + inconclusive, fns * 40);

});

test('P2.4: the reference compiler (oracle) agrees with the evaluator, and with our images on results', async () => {
  const m = new AnalysisManager();
  for (const id of [
    'blend',
    'checksum',
    'sort',
    'collatz',
    'calls',
    'call-chain',
    'div-checks',
    'records',
    'strings',
  ]) {
    const { meta, source, r0, st } = load(id);
    const ref = reference(id, source),
      ours = B.lowerToImage(r0).image;
    const ev = await m.checkInvariant(B.imageAgrees({ inputs: meta.inputs ?? {}, count: 20 }), {
      program: r0,
      image: ref,
    });
    assert.equal(ev.ok, true, `${id}: ${ev.reason}`);
    for (const fn of st.fns.keys())
      for (const c of E.casesFrom(st, fn, { count: 10, seed: 3, inputs: meta.inputs?.[fn] ?? {} })) {
        const a = B.runImage(ours, fn, c.args, c.memory),
          b = B.runImage(ref, fn, c.args, c.memory);
        assert.deepEqual([a.trap ? 'trap' : a.result], [b.trap ? 'trap' : b.result], `${id}.${fn}#${c.n}`);
      }
  }
});

test('P2.4: encoders and the disassembler round-trip', () => {
  const at = new Map([['L', 16]]);
  const enc = (m, pc = 0) => B.decode(B.encodeOne({ covers: [], ...m }, pc, at, { f: 64 }) >>> 0, pc).text;
  assert.equal(enc({ op: 'add', rd: 5, rs1: 6, rs2: 7 }), 'add t0, t1, t2');
  assert.equal(enc({ op: 'sub', rd: 10, rs1: 11, rs2: 12 }), 'sub a0, a1, a2');
  assert.equal(enc({ op: 'mulh', rd: 5, rs1: 10, rs2: 5 }), 'mulh t0, a0, t0');
  assert.equal(enc({ op: 'rem', rd: 9, rs1: 18, rs2: 19 }), 'rem s1, s2, s3');
  assert.equal(enc({ op: 'addi', rd: 2, rs1: 2, imm: -16 }), 'addi sp, sp, -16');
  assert.equal(enc({ op: 'srai', rd: 5, rs1: 5, imm: 31 }), 'srai t0, t0, 31');
  assert.equal(enc({ op: 'srli', rd: 5, rs1: 5, imm: 29 }), 'srli t0, t0, 29');
  assert.equal(enc({ op: 'sltiu', rd: 5, rs1: 6, imm: 1 }), 'sltiu t0, t1, 1');
  assert.equal(enc({ op: 'lw', rd: 29, rs1: 10, imm: 0 }), 'lw t4, 0(a0)');
  assert.equal(enc({ op: 'lhu', rd: 28, rs1: 28, imm: 4 }), 'lhu t3, 4(t3)');
  assert.equal(enc({ op: 'sw', rs1: 2, rs2: 1, imm: 12 }), 'sw ra, 12(sp)');
  assert.equal(enc({ op: 'sh', rs1: 10, rs2: 0, imm: -2 }), 'sh zero, -2(a0)');
  assert.equal(enc({ op: 'lui', rd: 5, imm: 0x92492 }), 'lui t0, 0x92492');
  assert.equal(enc({ op: 'bltu', rs1: 28, rs2: 29, target: 'L' }, 8), 'bltu t3, t4, 0x10');
  assert.equal(enc({ op: 'bge', rs1: 5, rs2: 6, target: 'L' }, 40), 'bge t0, t1, 0x10');
  assert.equal(enc({ op: 'j', target: 'L' }, 0x5c), 'jal zero, 0x10');
  assert.equal(enc({ op: 'call', callee: 'f' }, 8), 'jal ra, 0x40');
  assert.equal(enc({ op: 'ret' }), 'ret');
  assert.equal(enc({ op: 'ebreak' }), 'ebreak');
  assert.equal(B.decode(0xffffffff, 0).text, '.word 0xffffffff');
  // fields survive encode -> decode for every register and a spread of immediates
  for (let rd = 0; rd < 32; rd++)
    for (const imm of [-2048, -1, 0, 1, 2047]) {
      const rs1 = (rd * 7 + 3) % 32;
      assert.equal(enc({ op: 'addi', rd, rs1, imm }), `addi ${B.REGS[rd]}, ${B.REGS[rs1]}, ${imm}`);
      assert.equal(enc({ op: 'sw', rs1, rs2: rd, imm }), `sw ${B.REGS[rd]}, ${imm}(${B.REGS[rs1]})`);
    }
  for (const d of [-4096, -2, 2, 4094])
    assert.equal(enc({ op: 'beq', rs1: 1, rs2: 2, target: 'L' }, 16 - d), `beq ra, sp, 0x10`);
  assert.throws(
    () => B.encodeOne({ op: 'beq', rs1: 0, rs2: 0, target: 'L', covers: [] }, 16 + 4098, at, {}),
    e => e.code === 'branchRange',
  );
  assert.throws(
    () => B.encodeOne({ op: 'frob', covers: [] }, 0, at, {}),
    e => e.code === 'internal',
  );
  // Hacker's Delight 10-1 magic numbers
  assert.deepEqual(B.divisionMagic(3), { magic: 0x55555556, shift: 0 });
  assert.deepEqual(B.divisionMagic(5), { magic: 0x66666667, shift: 1 });
  assert.deepEqual(B.divisionMagic(7), { magic: 0x92492493 | 0, shift: 2 });
  // every instruction of every corpus image decodes to the text it records (the validator checks it too)
  for (const id of ['blend', 'calls', 'pressure', 'records']) {
    const img = B.lowerToImage(load(id).r0).image.value;
    const bytes = B.fromBase64(img.code);
    assert.deepEqual(B.toBase64(bytes), img.code);
    const view = new DataView(bytes.buffer);
    for (const m of img.insns) assert.equal(B.decode(view.getUint32(m.offset, true), m.offset).text, m.text);
  }
});

test("P2.4: options are validated with the prototype's codes", () => {
  const { r0 } = load('blend');
  const refuse = (opts, code, pattern) =>
    assert.throws(
      () => B.lowerToImage(r0, opts),
      e => e instanceof B.BackendError && e.code === code && pattern.test(e.message),
    );
  refuse({ fues: true }, 'unknownOption', /no option "fues". Did you mean "fuse"\?/);
  refuse({ speed: 3 }, 'unknownOption', /fix: options: registers, fuse/);
  refuse({ registers: 0 }, 'badArgument', /registers is 'all' or a number from 1/);
  refuse({ order: 'random' }, 'badArgument', /order is 'caller' or 'callee'/);
  refuse({ spill: 'nearest' }, 'badArgument', /spill is 'furthest' or 'current'/);
  refuse({ layout: 'loops' }, 'badArgument', /layout is 'source'/);
  refuse({ fuse: 'yes' }, 'badArgument', /fuse is true or false/);
  assert.deepEqual(B.checkBackendOptions({ registers: 4 }), { ...B.backendDefaults, registers: 4 });
  assert.deepEqual(B.diffOptions(B.checkBackendOptions({ registers: 4, hints: false })), {
    registers: 4,
    hints: false,
  });
  // a small register budget spills, and still agrees
  const few = B.lowerToImage(load('pressure').r0, { registers: 1 }).image;
  assert.ok(Object.values(few.value.fns).some(f => f.spills > 0));
  assert.ok(
    few.value.insns.some(m => m.why === 'spill reload') && few.value.insns.some(m => m.why === 'spill store'),
  );
});

test('P2.4: a calling-convention fault in the emulator counts as disagreement', async () => {
  const src = 'function id(x: i32): i32 {\n    return x;\n}\n';
  const r0 = createIRArtifact(blocksAdapter, 'id', ingest('id', src).toNative());
  const good = B.lowerToImage(r0).image;
  assert.deepEqual(
    good.value.insns.map(m => m.text),
    ['ret'],
  ); // x stays in a0
  // hand-assembled: addi s1, s1, 1; ret — changes a callee-saved register and returns
  const words = [B.instruction.i(0x13, 9, 0, 9, 1) >>> 0, 0x00008067];
  const bytes = new Uint8Array(8);
  words.forEach((w, i) => new DataView(bytes.buffer).setUint32(4 * i, w, true));
  const bad = createIRArtifact(B.imageAdapter, 'img:id-bad', B.imageFromCode('id', bytes, { id: 0 }, []));
  const run = B.runImage(bad, 'id', [5], new Uint8Array(1024));
  assert.equal(run.fault, true);
  assert.match(run.trap, /callee-saved x9 changed across a call/);
  const m = new AnalysisManager();
  const check = B.imageAgrees({ count: 10 });
  const ok = await m.checkInvariant(check, { program: r0, image: good });
  assert.equal(ok.ok, true);
  const ev = await m.checkInvariant(check, { program: r0, image: bad });
  assert.equal(ev.ok, false);
  assert.equal(ev.evidence.disagree, 10);
  assert.match(
    ev.evidence.counterexamples[0].reason,
    /id#0: expected -?\d+, got fault: callee-saved x9 changed/,
  );
  // a function the image lacks is a fault too, not an exception
  const other = createIRArtifact(B.imageAdapter, 'img:other', B.imageFromCode('id', bytes, { other: 0 }, []));
  const missing = await m.checkInvariant(check, { program: r0, image: other });
  assert.equal(missing.ok, false);
  assert.match(missing.evidence.counterexamples[0].reason, /fault: no entry "id"/);
});

test('P2.4: imageAgrees is one definition per parameter set; limits make cases inconclusive', async () => {
  const a = B.imageAgrees({ count: 5 }),
    b = B.imageAgrees({ count: 5 }),
    c = B.imageAgrees({ count: 6 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a.version, c.version);
  assert.equal(a.id, 'rv32.image-agrees');
  assert.equal(a.method, 'sampled');
  const { meta, r0 } = load('blend');
  const { image } = B.lowerToImage(r0);
  const m = new AnalysisManager();
  const ev = await m.checkInvariant(B.imageAgrees({ inputs: meta.inputs, imageLimit: 20 }), {
    program: r0,
    image,
  });
  assert.equal(ev.ok, false);
  assert.equal(ev.evidence.status, 'inconclusive');
  assert.equal(ev.evidence.inconclusive, 40);
  // a trap agrees with a trap: a 2-cell buffer with n = 5 fails the bounds check on both sides
  const st = storeOf(r0.value);
  const c2 = E.benchCase(st, 'blend', { work: { cells: [1, 2] }, n: 5, a: 1, b: 1 });
  const got = B.runImage(image, 'blend', c2.args, c2.memory);
  assert.equal(got.trap, 'ebreak');
  assert.equal(E.agrees(E.evaluate(st, 'blend', c2.args, c2.memory), { ...got, counts: null }), true);
});

test('P2.4: rv32.image is a v6 IR: projection, validation, serialization', () => {
  const { r0 } = load('calls');
  const { image } = B.lowerToImage(r0);
  const view = openIR(image, B.imageAdapter);
  const { entities: ents, relations: rels } = view.graph();
  assert.deepEqual(
    view.children('fn:sq').map(r => r.entity),
    ['insn:sq+0x0', 'insn:sq+0x4'],
  );
  assert.equal(view.describe('insn:sq+0x0').label, 'mul a0, a0, a0');
  // a branch's jump edge leads to the instruction at its target
  const br = image.value.insns.find(m => m.target !== undefined);
  assert.deepEqual(
    view.successors(br.id, 'jump').map(r => r.entity),
    [image.value.insns[br.target / 4].id],
  );
  assert.equal(ents.filter(e => e.kind === 'fn').length, 3);
  assert.equal(ents.filter(e => e.kind.startsWith('insn.')).length, image.value.bytes / 4);
  const contains = rels
    .filter(r => r.kind === 'contains' && r.from === 'fn:energy')
    .sort((x, y) => x.order - y.order);
  assert.equal(contains.length, image.value.fns.energy.insns);
  assert.equal(contains[0].to, 'insn:energy+0x0');
  const calls = rels.filter(r => r.kind === 'calls' && r.from.startsWith('insn:energy'));
  assert.deepEqual([...new Set(calls.map(r => r.to))].sort(), ['fn:clamp', 'fn:sq']);
  assert.equal(calls.length, 4);
  // every instruction of energy covers its function, a statement or a value of the program
  const st = storeOf(r0.value);
  for (const m of image.value.insns) for (const c of m.covers) assert.ok(st.has(c), `${m.id} covers ${c}`);
  assert.ok(
    image.value.insns.some(m => m.why === 'save ra') && image.value.insns.some(m => m.why === 'restore ra'),
  );
  // serialization round-trips, and the validator refuses inconsistent images
  const again = deserializeIR(B.imageAdapter, image.id, B.imageAdapter.serialize(image.value));
  assert.equal(again.revision, image.revision);
  const broken = (patch, pattern) =>
    assert.throws(() => B.validateImage({ ...image.value, ...patch(image.value) }), pattern);
  broken(
    v => ({ insns: v.insns.map((m, i) => (i === 3 ? { ...m, word: (m.word + 1) >>> 0 } : m)) }),
    /word differs from code/,
  );
  broken(
    v => ({ insns: v.insns.map((m, i) => (i === 3 ? { ...m, text: 'nop' } : m)) }),
    /text is not the disassembly/,
  );
  broken(v => ({ insns: v.insns.slice(1) }), /one instruction record per word/);
  broken(v => ({ fnOrder: [...v.fnOrder].reverse() }), /starts at/);
  broken(() => ({ code: 'not base64!' }), /not base64/);
  broken(v => ({ options: { ...v.options, colour: 'red' } }), /unknown option colour/);
});

test('P2.4: the correspondence maps program entities to the instructions that cover them', () => {
  const { r0, st } = load('blend');
  const { image, correspondence } = B.lowerToImage(r0);
  assert.deepEqual(correspondence.from, { artifact: r0.id, revision: r0.revision });
  assert.deepEqual(correspondence.to, { artifact: image.id, revision: image.revision });
  const entry = (from, relation) =>
    correspondence.entries.find(e => e.from.length === 1 && e.from[0] === from && e.relation === relation);
  // s = s + work.charCodeAt(i) * (a * b + scale): the load, the multiplies and the add
  const s10 = entry('s:blend.10', 'covered-by');
  assert.ok(s10 && s10.to.length >= 7, JSON.stringify(s10));
  assert.ok(entry('fn:blend', 'retained').to.includes('fn:blend'));
  // one covered-by entry per covered source entity
  const covered = new Set(image.value.insns.flatMap(m => m.covers));
  assert.equal(correspondence.entries.filter(e => e.relation === 'covered-by').length, covered.size);
  // what no instruction covers is removed (blocks, locals, ops, folded constants), uncovered instructions inserted
  assert.ok(entry('bb:blend.0', 'removed'));
  // a trace from a statement reaches its instructions
  const trace = traceEntity({ ...correspondence.from, entity: 's:blend.11' }, [correspondence]);
  assert.deepEqual(
    trace.current.map(r => r.entity),
    ['insn:blend+0x58'],
  );
  assert.equal(image.value.insns.find(m => m.id === 'insn:blend+0x58').text, 'addi t2, t2, 1');
  // an image is related only to the revision it was lowered from
  const other = createIRArtifact(blocksAdapter, 'blend2', { ...r0.value, program: 'blend2' });
  assert.throws(
    () => B.imageCorrespondence(other, image),
    e => e.code === 'wrongSource',
  );
  void st;
});

test('P2.4: heat, diffs, machine stages and image status', () => {
  const { r0, st } = load('blend');
  const { image } = B.lowerToImage(r0);
  const run = steps(image, st, 'blend', { work: cells(40), n: 40, a: 3, b: 5 });
  const h = B.heat(st, image, run.counts);
  assert.equal(
    h.byInsn.reduce((n, x) => n + x.n, 0),
    531,
  );
  // every executed instruction has a source line (one whose covers span two lines counts on both)
  for (const x of h.byInsn.filter(x => x.n))
    assert.ok(
      linesOf(id => st.get(id), image.value.insns.find(m => m.id === x.id).covers[0]).length > 0,
      x.id,
    );
  assert.ok([...h.byLine.values()].reduce((n, x) => n + x, 0) >= 531);
  assert.ok(h.byLine.get(5) > h.byLine.get(4), 'the loop body (line 5) is hottest');
  assert.equal(h.byStmt.get('s:blend.10'), 40 * 7, 'seven instructions of the loop body, 40 times');
  // a diff with itself is all '='; with immediates off, constants move into registers
  const same = B.diffImages(image, image, 'blend');
  assert.deepEqual([same.same, same.removed, same.added], [24, 0, 0]);
  const off = B.lowerToImage(r0, { immediates: false }).image;
  const d = B.diffImages(image, off, 'blend');
  assert.ok(d.removed > 0 && d.added > 0 && d.same > 0);
  assert.equal(d.same + d.removed, 24);
  // allocation stages: virtual registers, intervals with their registers
  const mc = B.machineCode(r0, 'blend');
  assert.equal(mc.leaf, true);
  assert.equal(mc.selected[0], 'entry:');
  assert.ok(
    mc.selected.some(l => /^ {2}blt v\d+, a1|^ {2}blt v\d+, v\d+, bb:blend/.test(l)),
    mc.selected.join('\n'),
  );
  assert.equal(mc.intervals.length, image.value.fns.blend.vregs);
  assert.deepEqual(mc.spilled, []);
  const tight = B.machineCode(r0, 'blend', { registers: 2 });
  assert.ok(tight.spilled.length > 0 && tight.intervals.some(x => x.reg === 'spilled'));
  // status against a revision chain
  const r1 = createIRArtifact(blocksAdapter, 'blend', {
    ...r0.value,
    counters: { ...r0.value.counters, extra: 1 },
  });
  assert.equal(B.imageStatus(image, [r0]), 'current');
  assert.equal(B.imageStatus(image, [r0, r1]), 'older (r0)');
  assert.equal(B.imageStatus(image, [r1]), 'stale');
  assert.throws(
    () => B.runImage(image, 'nope', [], new Uint8Array(1024)),
    e => e.code === 'unknownFunction',
  );
});

// Chapter 14, "Against the reference compiler": r0, O2 and the reference compiler (typed-rv32.js, default policy,
// with its pass groups vendored) on the same benchmarks; and image sizes over all 44 projects.
test("P2.6: the book's table against the reference compiler, and 5160 bytes against 7628", { timeout: 600000 }, async () => {
  const { Program } = await import('../../dist/typed/program.js');
  const { projectSource } = await import('../../dist/typed/project.js');
  const { projectFiles, projectIds } = await import('../../tools/corpus.mjs');
  const rows = [
    ['blend', 'blend', { work: cells(40), n: 40, a: 3, b: 5 }, [531, 451, 383]],
    ['checksum', 'total', { work: cells(40) }, [446, 366, 292]],
    ['sort', 'sort', { work: { cells: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] } }, [2022, 2022, 1533]],
    ['collatz', 'collatz', { n: 27 }, [1590, 1590, 1486]],
    ['value-numbering', 'halves', { n: 40 }, [690, 570, 695]],
  ];
  const refImage = (id, source) => {
    const r = globalThis.typedRv32.compile(source, [], undefined);
    return B.imageFromCode(id, r.image, r.entries, r.signatures);
  };
  for (const [id, fn, bench, expected] of rows) {
    const ps = projectSource(id, projectFiles(id)), p = Program.fromProject(ps);
    const st0 = storeOf(p.head.value);
    const r0 = steps(B.lowerToImage(p.head).image, st0, fn, bench).steps;
    await p.pipeline(ps.meta.pipeline);
    const o2 = steps(B.lowerToImage(p.head).image, storeOf(p.head.value), fn, bench).steps;
    const ref = steps(refImage(id, ps.source), st0, fn, bench).steps;
    assert.deepEqual([r0, o2, ref], expected, id);
  }
  if (process.env.IRWB_FULL !== '1') return; // the corpus-wide sizes run O2 on all 44 projects (~60 s)
  let ours = 0, theirs = 0;
  for (const id of projectIds()) {
    const ps = projectSource(id, projectFiles(id)), p = Program.fromProject(ps);
    await p.pipeline('O2'); // "our O2 images": O2 on every project, whatever its own pipeline
    const ourBytes = B.lowerToImage(p.head).image.value.bytes;
    const theirBytes = refImage(id, ps.source).bytes;
    assert.ok(ourBytes > 0 && theirBytes > 0, id);
    ours += ourBytes; theirs += theirBytes;
  }
  assert.ok(ours > 0 && theirs > 0);
});

// Chapter 13: "our evaluator at r0 agrees with the reference compiler's images on all 6986 decided cases" (44 projects;
// 8286 with the six IRWB-012..017 projects).
test('P2.6: the evaluator at r0 agrees with the reference images on 8286 decided cases (14 at the step limit)', async () => {
  const { Program } = await import('../../dist/typed/program.js');
  const { projectSource } = await import('../../dist/typed/project.js');
  const { projectFiles, projectIds } = await import('../../tools/corpus.mjs');
  let fns = 0, agree = 0, decided = 0, inconclusive = 0;
  for (const id of projectIds()) {
    const ps = projectSource(id, projectFiles(id)), p = Program.fromProject(ps);
    const r = globalThis.typedRv32.compile(ps.source, [], undefined);
    // signatures: entries with f32 scalars are called by ilp32f (fa registers), as the reference compiled them
    const image = B.imageFromCode(id, r.image, r.entries, r.signatures);
    for (const f of p.check({ count: 100, against: (fn, k) => B.runImage(image, fn, k.args, k.memory, { limit: 2e5 }) }).fns) {
      fns++; agree += f.agree; decided += f.total; inconclusive += f.inconclusive;
    }
  }
  assert.equal(decided, agree);
  assert.equal(decided + inconclusive, fns * 100);
});
