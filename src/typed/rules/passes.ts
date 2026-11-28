/**
 * `simplify` and `fold` as passes, twice: from the rule tables and from the hand-written bodies. Both variants keep
 * the specs of the passes in passes.ts (name, writes, preserves), so their origins name the same pass. They exist
 * for the equivalence check (tests/typed/rules.test.mjs, the ticket's scripts) and for measuring rule firings.
 * This module imports passes.ts; passes.ts never imports it.
 */
import { fold, simplify, typedPass, type TypedPass } from '../passes.js';
import { tableBody, type Firings } from './compile.js';
import { FOLD_RULES } from './fold.js';
import { foldBody, simplifyBody } from './handwritten.js';
import { SIMPLIFY_RULES } from './simplify.js';

/** The table-driven pass for `simplify` or `fold`, optionally counting rule firings into `firings`. */
export function tablePass(name: 'simplify' | 'fold', firings?: Firings): TypedPass {
  const base = name === 'simplify' ? simplify : fold,
    rules = name === 'simplify' ? SIMPLIFY_RULES : FOLD_RULES;
  return typedPass({ ...base.typed, body: tableBody(rules.rules, firings, rules.name) });
}
export const simplifyTable = tablePass('simplify');
export const foldTable = tablePass('fold');

/** The hand-written bodies under the same specs: the reference the tables are compared with. */
export const simplifyHandwritten = typedPass({ ...simplify.typed, body: simplifyBody });
export const foldHandwritten = typedPass({ ...fold.typed, body: foldBody });
