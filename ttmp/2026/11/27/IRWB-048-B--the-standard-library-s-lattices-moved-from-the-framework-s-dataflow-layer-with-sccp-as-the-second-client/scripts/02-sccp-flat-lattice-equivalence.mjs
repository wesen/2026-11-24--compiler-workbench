#!/usr/bin/env node
// IRWB-048-B probe: SCCP's private three-level lattice and the library's flat lattice are the same lattice.
// The port is only a change of element spelling: the old lattice put "not yet seen to execute" in a variant called
// `top` and "varies" in one called `bot`, while the library puts them at `BOT` and `TOP` (its bottom and top in the
// join order). This script enumerates both element domains and checks, for every pair, that
//     library join (mapped a, mapped b)  ==  mapped (old meet a b)      and the same for equality,
// where the mapping is old-{k:'top'} -> BOT, old-{k:'bot'} -> TOP, old constant -> {value}. Every other line of
// sccp.ts is unchanged, so equal lattice operations over the same values give the same fixpoint. Run after
// `npm run build`: node ttmp/2026/11/27/IRWB-048-B--*/scripts/02-sccp-flat-lattice-equivalence.mjs
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../../../..');
const { BOT, TOP, flatLattice } = await import(pathToFileURL(resolve(root, 'dist/stdlib/index.js')).href);

// The lattice as sccp.ts had it before IRWB-048-B (the same names as the algorithm in the paper).
const OLD_TOP = { k: 'top' }, // W-Z ⊤: not yet seen to execute — the library's bottom
  OLD_BOT = { k: 'bot' }; // W-Z ⊥: varies — the library's top
const oldSame = (a, b) => a.k === b.k && (a.k !== 'const' || (b.k === 'const' && a.v === b.v && a.t === b.t));
const oldMeet = (a, b) => (a.k === 'top' ? b : b.k === 'top' ? a : a.k === 'const' && oldSame(a, b) ? a : OLD_BOT);

const consts = [
  { k: 'const', v: 7, t: 'i32' },
  { k: 'const', v: 7, t: 'f32' },
  { k: 'const', v: 8, t: 'i32' },
];
const oldValues = [OLD_TOP, OLD_BOT, ...consts];
const toLibrary = a => (a.k === 'top' ? BOT : a.k === 'bot' ? TOP : { value: { v: a.v, t: a.t } });

const flat = flatLattice();
let pairs = 0;
for (const a of oldValues)
  for (const b of oldValues) {
    pairs++;
    assert.deepEqual(flat.join(toLibrary(a), toLibrary(b)), toLibrary(oldMeet(a, b)), `join ${JSON.stringify(a)}, ${JSON.stringify(b)}`);
    assert.equal(flat.equal(toLibrary(a), toLibrary(b)), oldSame(a, b), `equal ${JSON.stringify(a)}, ${JSON.stringify(b)}`);
  }
// The two namings are each other's image, and the library's bottom/top are where the mapping says.
assert.equal(toLibrary(OLD_TOP), BOT);
assert.equal(toLibrary(OLD_BOT), TOP);
console.log(`the flat lattice is SCCP's lattice: ${pairs} pairs agree on join and equal; the old top is BOT, the old bot is TOP`);
