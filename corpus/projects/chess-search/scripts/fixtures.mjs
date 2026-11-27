import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { projectFiles } from '../../../../tools/corpus.mjs';
import { installVendor } from '../../../../tools/node-vendor.mjs';

export const id = 'chess-search';
export const { reference, positions } = JSON.parse(
  readFileSync(new URL('../fixtures/reference-positions.json', import.meta.url), 'utf8'),
);

export const POSITION_CELLS = 135;
export const PERFT_CELLS = 2048;
export const SEARCH_CELLS = 9216;
const LIST = 512;
const UNDO = 256;
const EVAL_LIMIT = 20_000_000;
const IMAGE_LIMIT = 30_000_000;
const SEARCH_BUDGET = 1600;

export const zeroState = {
  running: 0, ply: 0, depth: 0, maxDepth: 0, budget: 0,
  nodes: 0, completed: 0, bestMove: 0, score: 0, advanced: 0,
};

// Adapted from the upstream bench/host/chess-engine.mjs.
export function encodeBoard(fen, size) {
  const [ranks, side, castle, ep, half, full] = fen.split(' ');
  const board = new Array(size).fill(0);
  for (const [rank, row] of ranks.split('/').entries()) {
    let file = 0;
    for (const ch of row) {
      if (Number(ch)) {
        file += Number(ch);
        continue;
      }
      const square = rank * 16 + file++;
      board[square] = ' PNBRQK  pnbrqk'.indexOf(ch);
      if (ch === 'K') board[131] = square;
      if (ch === 'k') board[132] = square;
    }
    assert.equal(file, 8);
  }
  board[128] = Number(side === 'b');
  for (const [i, right] of [...'KQkq'].entries()) {
    if (castle.includes(right)) board[129] += 2 ** i;
  }
  board[130] = ep === '-' ? 128 : (8 - Number(ep[1])) * 16 + ep.charCodeAt(0) - 97;
  board[133] = Number(half);
  board[134] = Number(full);
  return board;
}

const square = dense => 'abcdefgh'[dense % 8] + (8 - Math.floor(dense / 8));
const uci = move => move
  ? square(Math.floor(move / 64) % 64) + square(move % 64) + ('qrbn'[Math.floor(move / 4096) - 1] ?? '')
  : null;

export function fixture(name) {
  const position = positions.find(position => position.name === name);
  assert.ok(position, name);
  return position;
}

export async function loadProject() {
  await installVendor({ reference: true });
  const { Program } = await import('../../../../dist/typed/program.js');
  const { projectSource } = await import('../../../../dist/typed/project.js');
  const { storeOf } = await import('../../../../dist/typed/ir.js');
  const evaluate = await import('../../../../dist/typed/evaluate.js');
  const backend = await import('../../../../dist/typed/backend/index.js');
  const project = projectSource(id, projectFiles(id));
  const program = Program.fromProject(project);
  assert.equal(program.status, 'ok', JSON.stringify(program.error));
  return { project, program, store: storeOf(program.origin.value), evaluate, backend };
}

export async function buildImages({ project, program, backend }) {
  const baseline = backend.lowerToImage(program.origin).image;
  const run = await program.pipeline(project.meta.pipeline);
  assert.ok(run.steps.some(step => step.changed), 'speed must change the program');
  assert.deepEqual(run.steps.filter(step => step.rejected), [], 'speed pass rejections');
  const optimized = backend.lowerToImage(program.head, { chains: true, coalesce: true, homes: true }).image;
  const compiled = globalThis.typedRv32.compile(project.source, [], undefined);
  return {
    r0: baseline,
    speed: optimized,
    reference: backend.imageFromCode(id, compiled.image, compiled.entries, compiled.signatures),
  };
}

function assertCompleted(run, label) {
  assert.equal(run.limit, false, `${label} limit`);
  assert.equal(run.trap, false, `${label} trap`);
  assert.ok(!run.fault, `${label} fault`);
}

function runCase(context, images, k, label, evalLimit, imageLimit) {
  const { store, evaluate, backend } = context;
  const expected = evaluate.evaluate(store, k.fn, k.args, k.memory, { limit: evalLimit });
  assertCompleted(expected, `${label} evaluator`);
  const instructions = {};
  for (const [name, image] of Object.entries(images)) {
    const run = backend.runImage(image, k.fn, k.args, k.memory, { limit: imageLimit, counts: false });
    assertCompleted(run, `${label} ${name}`);
    assert.equal(run.result, expected.result, `${label} ${name} result`);
    assert.deepEqual(run.bytes, expected.bytes, `${label} ${name} guest memory`);
    instructions[name] = run.steps;
  }
  return { ...expected, instructions };
}

export function checkGenerated(context, images) {
  const { project, program, store, evaluate } = context;
  const { entries, inputs } = project.meta;
  assert.deepEqual(entries, ['chessSearch', 'chessPerft']);
  const checked = program.check({ count: 20 });
  assert.deepEqual(checked.fns.map(row => row.fn), entries);

  const perft = fixture('en-passant-pinned');
  const promotion = fixture('promotion-and-underpromotion');
  assert.deepEqual(inputs.chessPerft, { board: { cells: encodeBoard(perft.fen, PERFT_CELLS) }, depth: 1 });
  assert.deepEqual(inputs.chessSearch, {
    board: { cells: encodeBoard(promotion.fen, SEARCH_CELLS) },
    state: { record: zeroState },
    depth: { oneOf: [1, 2, 3] },
    budget: 2,
    advanced: { bool: true },
  });
  const legal = runFixture(context, images, 'chessLegalMoves', {
    board: { cells: encodeBoard(promotion.fen, PERFT_CELLS) }, list: LIST, undo: UNDO,
  }, promotion.name);
  assert.ok(legal.result > 0);
  const fallback = legal.cells[LIST];

  const rows = [];
  for (const row of checked.fns) {
    assert.equal(row.status, 'agree', row.fn);
    assert.equal(row.agree, 20, row.fn);
    assert.equal(row.total, 20, row.fn);
    assert.equal(row.bothTrap, 0, row.fn);
    assert.equal(row.inconclusive, 0, row.fn);
    let maxStatements = 0;
    for (const k of evaluate.casesFrom(store, row.fn, { count: 20, inputs: inputs[row.fn] })) {
      const label = `${row.fn} generated #${k.n}`;
      const run = runCase(context, images, k, label, 20_000, 200_000);
      maxStatements = Math.max(maxStatements, run.steps);
      if (row.fn === 'chessSearch') {
        const state = readState(store, run.bytes, k.args[1]);
        assert.equal(run.result, fallback, label);
        assert.equal(state.completed, 0, label);
        assert.equal(state.nodes, 2, label);
        assertStopped(state, run.result, label);
      } else {
        assert.equal(run.result, 6, label);
      }
      const board = evaluate.readBuffer(run.bytes, k.args[0]);
      assert.deepEqual(board.slice(0, POSITION_CELLS), inputs[row.fn].board.cells.slice(0, POSITION_CELLS), label);
    }
    rows.push({ entry: row.fn, cases: row.agree, maxStatements });
  }
  return rows;
}

function runFixture(context, images, fn, args, label) {
  const k = context.evaluate.benchCase(context.store, fn, args);
  const run = runCase(context, images, k, `${label} ${fn}`, EVAL_LIMIT, IMAGE_LIMIT);
  const memory = new DataView(run.bytes.buffer, run.bytes.byteOffset, run.bytes.byteLength);
  const boardAt = k.args[0];
  const cells = Array.from({ length: args.board.cells.length }, (_, i) =>
    memory.getUint16(boardAt + 4 + 2 * i, true),
  );
  assert.deepEqual(cells.slice(0, POSITION_CELLS), args.board.cells.slice(0, POSITION_CELLS), `${label} ${fn} restored position`);
  return { ...run, cells, stateAt: k.args[1] };
}

export function checkMoveFixtures(context, images) {
  return positions.map(position => {
    const { name, fen } = position;
    const board = { cells: encodeBoard(fen, PERFT_CELLS) };
    const legal = runFixture(context, images, 'chessLegalMoves', { board, list: LIST, undo: UNDO }, name);
    const moves = legal.cells.slice(LIST, LIST + legal.result).map(uci).sort();
    assert.deepEqual(moves, position.legal_uci, `${name} legal moves`);
    const check = runFixture(context, images, 'chessInCheck', { board, side: board.cells[128] }, name);
    assert.equal(check.result, Number(position.in_check), `${name} check status`);
    const perft = {};
    for (const [depth, expected] of Object.entries({ 0: 1, ...position.perft })) {
      const run = runFixture(context, images, 'chessPerft', { board, depth: Number(depth) }, `${name} depth ${depth}`);
      assert.equal(run.result, expected, `${name} perft(${depth})`);
      perft[depth] = run.result;
    }
    return { position: name, legal: moves.length, inCheck: Boolean(check.result), perft };
  });
}

function readState(store, bytes, at) {
  const layout = store.frontEnd.records.SearchState;
  const memory = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Object.fromEntries(Object.entries(layout).map(([name, { offset }]) =>
    [name, memory.getInt32(at + offset, true)],
  ));
}

function assertStopped(state, result, label) {
  assert.equal(state.running, 0, `${label} stopped`);
  assert.equal(state.ply, 0, `${label} unwound`);
  assert.equal(state.bestMove, result, `${label} returned bestMove`);
}

export function checkSearchFixture(context, images, position, depth) {
  const { name, fen } = position;
  const board = { cells: encodeBoard(fen, SEARCH_CELLS) };
  const run = runFixture(context, images, 'chessSearch', {
    board, state: { record: zeroState }, depth, budget: SEARCH_BUDGET, advanced: 1,
  }, name);
  const state = readState(context.store, run.bytes, run.stateAt);
  assertStopped(state, run.result, name);
  assert.ok(state.nodes <= SEARCH_BUDGET, `${name} node budget`);
  const move = uci(run.result);
  if (position.legal_uci.length) {
    assert.ok(position.legal_uci.includes(move), `${name} returned legal move ${move}`);
  } else {
    assert.equal(run.result, 0, `${name} has no legal moves`);
  }
  if (position.mate_in_one_uci.length) {
    assert.ok(position.mate_in_one_uci.includes(move), `${name} mate in one`);
    assert.equal(state.score, 29999, name);
  }
  if (position.checkmate) assert.equal(state.score, -30000, name);
  if (position.stalemate) assert.equal(state.score, 0, name);
  if (name === 'defended-rook') assert.notEqual(move, 'd1d5', name);
  if (name === 'quiet-mate-in-two') {
    assert.equal(move, 'd6c7', name);
    assert.equal(state.score, 29997, name);
    assert.equal(state.completed, 3, name);
  }
  return {
    position: name, move, score: state.score, completed: state.completed, nodes: state.nodes,
    evaluatorStatements: run.steps, instructions: run.instructions,
  };
}

export const depthOneFixtures = positions.filter(position =>
  position.mate_in_one_uci.length || position.checkmate || position.stalemate || position.name === 'defended-rook',
);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2] ?? 'fixtures';
  assert.ok(['fixtures', 'measure'].includes(mode), 'usage: fixtures.mjs [fixtures|measure]');
  const context = await loadProject();
  const images = await buildImages(context);
  const quiet = () => checkSearchFixture(context, images, fixture('quiet-mate-in-two'), 3);
  const result = mode === 'measure' ? quiet() : {
    reference,
    generated: checkGenerated(context, images),
    moves: checkMoveFixtures(context, images),
    search: [...depthOneFixtures.map(position => checkSearchFixture(context, images, position, 1)), quiet()],
  };
  console.log(JSON.stringify(result, null, 2));
}
