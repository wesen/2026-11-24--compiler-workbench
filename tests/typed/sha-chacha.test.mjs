import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAllFiles } from '../../tools/corpus.mjs';
import { installVendor } from '../../tools/node-vendor.mjs';

await installVendor({ reference: true });

const { sha256 } = await import('../../dist/framework/core/data.js');
const { projectSource } = await import('../../dist/typed/project.js');
const { Program } = await import('../../dist/typed/program.js');
const { storeOf } = await import('../../dist/typed/ir.js');
const { agrees, benchCase, casesFrom, evaluate, readBuffer } = await import('../../dist/typed/evaluate.js');
const { imageFromCode, lowerToImage, runImage } = await import('../../dist/typed/backend/index.js');
const { createWb } = await import('../../dist/workbench/index.js');

const id = 'sha-chacha';
const files = projectAllFiles(id);
const project = projectSource(id, files);
const { entries, inputs } = project.meta;
const sha = 'sha256Block';
const chacha = 'chacha20Block';
const longestMessage = Array.from({ length: 55 }, (_, i) => i === 54 ? 127 : i);
const backendOptions = { coalesce: true, chains: true, homes: true };

function packLittleEndian(bytes) {
  return Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readUInt16LE(2 * i));
}

function shaCase(store, message) {
  return benchCase(store, sha, {
    message: { cells: message },
    roundK: inputs[sha].roundK,
    out: inputs[sha].out,
  });
}

function vectors(store) {
  return [
    [shaCase(store, []), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    [shaCase(store, [97, 98, 99]), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [shaCase(store, longestMessage), sha256(String.fromCharCode(...longestMessage))],
    // RFC 8439 section 2.3.2 and Appendix A.1, vector 1.
    [benchCase(store, chacha, {
      key: { cells: packLittleEndian(Buffer.from(
        '000102030405060708090a0b0c0d0e0f' + '101112131415161718191a1b1c1d1e1f', 'hex',
      )) },
      counter: 1,
      nonce: { cells: packLittleEndian(Buffer.from('000000090000004a00000000', 'hex')) },
      out: inputs[chacha].out,
    }), '10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e' +
        'd2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e'],
    [benchCase(store, chacha, {
      key: { cells: Array(16).fill(0) },
      counter: 0,
      nonce: { cells: Array(6).fill(0) },
      out: inputs[chacha].out,
    }), '76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7' +
        'da41597c5157488d7724e03fb8d84a376a43b8f41518a11cc387b669b2ee6586'],
  ];
}

function evalCase(store, c) {
  return evaluate(store, c.fn, c.args, c.memory, { limit: 20_000 });
}

function imageCase(image, c) {
  return runImage(image, c.fn, c.args, c.memory, { limit: 200_000, counts: false });
}

function assertCompleted(run, label) {
  assert.equal(run.limit, false, label);
  assert.equal(run.trap, false, label);
}

function assertOutput(c, run, hex, label) {
  assertCompleted(run, label);
  const out = c.items.find(item => item.name === 'out');
  const cells = readBuffer(run.bytes, out.at);
  assert.equal(cells.length, out.length, label);
  const bytes = Buffer.alloc(cells.length * 2);
  const littleEndian = c.fn === chacha;
  for (let i = 0; i < cells.length; i += 2) {
    const word = cells[i] | (cells[i + 1] << 16);
    if (littleEndian) bytes.writeInt32LE(word, i * 2);
    else bytes.writeInt32BE(word, i * 2);
  }
  assert.equal(bytes.toString('hex'), hex, label);
  const expected = Buffer.from(hex, 'hex');
  assert.equal(run.result, littleEndian ? expected.readInt32LE() : expected.readInt32BE(), label);
  for (const { name, at } of c.items) {
    if (name === 'out') continue;
    assert.deepEqual(readBuffer(run.bytes, at), readBuffer(c.memory, at), `${label}: input ${name}`);
  }
}

async function checkedPipeline(program, name) {
  const run = await program.pipeline(name);
  assert.deepEqual(run.steps.filter(step => step.rejected), [], name);
  for (const step of run.steps.filter(step => step.changed)) {
    assert.equal(step.check, '80/80', `${name} ${step.pass} ${step.rev}`);
  }
}

test('SHA-256 and ChaCha20 vectors, generated cases, and checked RV32 images', async t => {
  const speed = Program.fromProject(project);
  assert.equal(speed.status, 'ok', JSON.stringify(speed.error));
  assert.deepEqual(entries, [sha, chacha]);
  const r0 = storeOf(speed.origin.value);
  const fixed = vectors(r0);
  for (const [c, hex] of fixed) assertOutput(c, evalCase(r0, c), hex, `r0 ${c.fn}`);

  const referenceCode = globalThis.typedRv32.compile(project.source, [], undefined);
  const reference = imageFromCode(id, referenceCode.image, referenceCode.entries, referenceCode.signatures);
  const o2 = Program.fromProject(project);
  await checkedPipeline(o2, 'O2');
  await checkedPipeline(speed, 'speed');
  const images = {
    reference,
    O2: lowerToImage(o2.head).image,
    speed: lowerToImage(speed.head, backendOptions).image,
  };

  for (const [name, image] of Object.entries(images)) {
    for (const [c, hex] of fixed) assertOutput(c, imageCase(image, c), hex, `${name} ${c.fn}`);
  }

  // Reuse the same cases for all images. Include direct helper calls so the
  // reference check exercises the quarter round's four-word calling convention.
  for (const fn of r0.fns.keys()) {
    const generated = casesFrom(r0, fn, { count: 100, seed: 7, inputs: inputs[fn] });
    for (const c of generated) {
      const expected = evalCase(r0, c);
      const label = `${fn} case ${c.n}`;
      assertCompleted(expected, label);
      if (fn === sha) {
        const message = readBuffer(c.memory, c.args[0]);
        assertOutput(c, expected, sha256(String.fromCharCode(...message)), label);
      }
      for (const [name, image] of Object.entries(images)) {
        const got = imageCase(image, c);
        assertCompleted(got, `${name} ${label}`);
        assert.ok(agrees(expected, got), `${name} ${label}: result or memory differs from r0`);
      }
    }
  }

  for (const [c, hex] of [fixed[2], fixed[3]]) {
    const revisions = speed.revisions.map(({ rev, artifact }) => {
      const run = evalCase(storeOf(artifact.value), c);
      assertOutput(c, run, hex, `speed r${rev} ${c.fn}`);
      return run.steps;
    });
    t.diagnostic(`${c.fn} statements: r0 ${revisions[0]}, speed r${speed.rev} ${revisions.at(-1)}, peak ${Math.max(...revisions)}`);
  }
});

test('fresh SHA-256 and ChaCha20 exploration measures one block per kernel', async () => {
  const wb = createWb({ projects: [{ id, files }] });
  const open = wb.projects.open(id);
  const { options, measurements } = await open.run('explore');
  assert.deepEqual(options, backendOptions);
  assert.equal(open.program.rev, 'r0');
  assert.deepEqual(measurements.map(row => row.fn), [sha, chacha, sha, chacha]);
  for (const [i, row] of measurements.entries()) {
    assert.match(row.revision, i < 2 ? /^r0$/ : /^r[1-9]\d*$/);
    assert.ok(row.instructions > 0);
    assert.equal(row.instructionsPerByte, row.instructions / 64);
    assert.ok(row.hottest.length > 0);
  }
});
