// The three benchmark inputs the brief names (IRWB-015, IRWB-014, IRWB-017), shared by this ticket's scripts.
import { installVendor } from '../../../../../../tools/node-vendor.mjs';
await installVendor({ reference: true });
const D = '../../../../../../dist/';
const { benchCase, casesFrom } = await import(D + 'typed/evaluate.js');
const { encodeBoard, fixture, zeroState, SEARCH_CELLS } = await import(
  '../../../../../../corpus/projects/chess-search/scripts/fixtures.mjs'
);
export const BENCH = {
  regex: {
    id: 'regex-nfa',
    cases: st => [benchCase(st, 'regexMatch', { pattern: { string: '[a-c]*[b-d]*a*d' }, text: { string: 'abccabbd' } })],
  },
  lz: {
    id: 'lz-roundtrip',
    cases: (st, ps) => casesFrom(st, 'roundTrip', { count: 100, seed: 7, inputs: ps.meta.inputs.roundTrip }),
  },
  // not one of the three: the project's own perft input, a short run of the chess code for listings
  perft: {
    id: 'chess-search',
    cases: (st, ps) => casesFrom(st, 'chessPerft', { count: 1, seed: 7, inputs: ps.meta.inputs.chessPerft }),
  },
  chess: {
    id: 'chess-search',
    limit: 3e7,
    cases: st => [
      benchCase(st, 'chessSearch', {
        board: { cells: encodeBoard(fixture('quiet-mate-in-two').fen, SEARCH_CELLS) },
        state: { record: zeroState },
        depth: 3,
        budget: 1600,
        advanced: 1,
      }),
    ],
  },
};

