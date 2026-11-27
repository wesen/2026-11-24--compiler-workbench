/** A census of accepted Typed O2/speed edit records and their static statement footprint. */
import type { EntityCorrespondence } from '../framework/ir/types.js';
import { Store, type TypedBlocks, type ValueRec } from './model.js';
import { compileRules, isPow2, log2 } from './rules/compile.js';
import { RULE_EVIDENCE } from './rules/evidence.js';
import { FOLD_RULES } from './rules/fold.js';
import type { RuleSet } from './rules/form.js';
import { SIMPLIFY_RULES } from './rules/simplify.js';
import { ruleFingerprint, type Strength } from './rules/verify.js';
import { Tx, type Edit } from './tx.js';

export type EditClass = 'local' | 'structural' | 'other';
export interface MatchedRule {
  readonly name: string;
  readonly firings: number;
  readonly strength?: Strength;
  readonly cited: boolean;
}
export interface ClassifiedEdit {
  readonly edit: Edit;
  readonly classification: EditClass;
  readonly reason: string;
  /** IDs in either adjacent revision. A retained statement is identified by the same ID in both. */
  readonly statements: readonly string[];
  readonly rules: readonly MatchedRule[];
  readonly candidateShapes: readonly string[];
  /** An alternative classification of a value replacement that uses other statements. */
  readonly contextualShape?: string;
}

const fields = ['value', 'cond', 'addr'] as const;
const structural = new Set(['cfg', 'bce', 'licm', 'inline', 'rotate']);
const tables = new Map([
  ['fold', FOLD_RULES],
  ['simplify', SIMPLIFY_RULES],
]);
const contextual = new Map([
  ['constprop', 'read → constant with unanimous reaching definitions'],
  ['lvn', 'repeated pure expression → read of a shared temporary'],
  ['subst', 'read → pure RHS with a stable reaching assignment'],
]);
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

function valueOwners(revision: TypedBlocks): Map<string, string> {
  const owners = new Map<string, string>();
  const visit = (id: string, stmt: string) => {
    owners.set(id, stmt);
    for (const arg of revision.values[id].args) visit(arg, stmt);
  };
  for (const s of Object.values(revision.stmts))
    for (const field of fields) if (s[field]) visit(s[field], s.id);
  return owners;
}

function statementFootprints(before: TypedBlocks, after: TypedBlocks, correspondence: EntityCorrespondence) {
  const beforeOwners = valueOwners(before);
  const afterOwners = valueOwners(after);
  const related = new Map<string, Set<string>>();
  for (const entry of correspondence.entries)
    for (const id of entry.from) {
      for (const to of entry.to) {
        if (id === to || !after.stmts[to]) continue;
        const targets = related.get(id) ?? new Set<string>();
        targets.add(to);
        related.set(id, targets);
      }
    }

  return (edit: Edit) => {
    const ids = new Set<string>();
    const addStatement = (id: string | undefined) => {
      if (!id) return;
      if (before.stmts[id] || after.stmts[id]) ids.add(id);
      for (const to of related.get(id) ?? []) ids.add(to);
    };
    addStatement(text(edit.stmt));
    addStatement(text(edit.from));
    addStatement(text(edit.to));

    if (edit.kind === 'replace') {
      // A replacement can mention a tree made or consumed by another edit in this same transaction.
      // The explicit statement ID still identifies the site when those tree IDs are absent.
      const from = text(edit.from);
      const to = text(edit.to);
      const oldOwner = from && beforeOwners.get(from);
      const newOwner = to && afterOwners.get(to);
      addStatement(oldOwner);
      addStatement(newOwner);
    }
    const block = text(edit.block);
    if (block && (edit.kind === 'unreachable' || edit.kind === 'merge'))
      for (const stmt of before.blocks[block]?.stmts ?? []) ids.add(stmt);
    if (block && edit.kind === 'block')
      for (const stmt of after.blocks[block]?.stmts ?? []) ids.add(stmt);

    if (edit.kind === 'inline') {
      // The callee body is covered by its new block records. This also picks up parameter setup
      // and jumps whose origin is the call but which are inserted into an existing block.
      for (const cause of strings(edit.because)) if (before.values[cause]?.op === 'call') addStatement(cause);
    }
    return [...ids].sort();
  };
}

type ReadValue = (id: string) => ValueRec | undefined;
function sameRoot(a: ValueRec, b: ValueRec): boolean {
  return a.op === b.op && a.imm === b.imm && a.type === b.type && a.args.length === b.args.length;
}

function sameTree(readLeft: ReadValue, left: string, readRight: ReadValue, right: string): boolean {
  const a = readLeft(left);
  const b = readRight(right);
  return (
    !!a && !!b && sameRoot(a, b) && a.args.every((arg, i) => sameTree(readLeft, arg, readRight, b.args[i]))
  );
}

function replayTable(before: TypedBlocks, after: TypedBlocks, pass: string, table: RuleSet) {
  const matches = new Map<string, ReadonlyMap<string, number>>();
  const store = Store.from(before);
  const storedValue = (id: string) => store.get(id) as ValueRec | undefined;
  const afterValue = (id: string) => after.values[id];
  for (const fn of store.fns.values()) {
    const tx = new Tx(store, fn, { name: pass, writes: ['values'] }, after.rev);
    const firings = new Map<string, number>();
    const visit = compileRules(table.rules, firings)(tx);
    const groups: Map<string, number>[] = [];
    // Tx.rewrite emits a replacement once the whole field is visited. Its current edit
    // count indexes the field's pending firings, even when an outer rule drops a child.
    const saveFirings = () => {
      if (groups.length < tx.edits.length) {
        groups.push(new Map(firings));
        firings.clear();
      }
    };
    tx.rewrite(value => {
      saveFirings();
      return visit(value);
    });
    saveFirings();
    tx.edits.forEach((edit, i) => {
      const field = fields.find(f => f === edit.field);
      const stmt = text(edit.stmt);
      const replayed = text(edit.to);
      const actual = field && stmt ? after.stmts[stmt]?.[field] : undefined;
      if (stmt && replayed && actual && sameTree(storedValue, replayed, afterValue, actual))
        matches.set(`${stmt}/${field}`, groups[i]);
    });
  }
  return matches;
}

function describeRules(set: RuleSet, firings: ReadonlyMap<string, number>, edit: Edit): MatchedRule[] {
  const tokens = [...strings(edit.rules), ...strings(edit.because)];
  return set.rules.flatMap(rule => {
    const count = firings.get(rule.name);
    if (!count) return [];
    const evidence = RULE_EVIDENCE[rule.name];
    const matching =
      evidence?.verdict === 'sound' &&
      evidence.version === rule.version && evidence.fingerprint === ruleFingerprint(rule);
    const prefix = `rule:${set.name}/${rule.name}@${rule.version}#`;
    const cited = matching && tokens.some(token => {
      if (!token.startsWith(prefix)) return false;
      const fingerprint = token.slice(prefix.length);
      return /^[0-9a-f]+$/.test(fingerprint) && evidence.fingerprint.startsWith(fingerprint);
    });
    return [{ name: rule.name, firings: count, strength: matching ? evidence.strength : undefined, cited }];
  });
}

// Shape recognition, with the range premise recorded by strength. The pass's actual range
// result is trusted for this census. The premise would need a checked witness in a proof.
function strengthShapes(before: TypedBlocks, after: TypedBlocks, from: string, to: string): string[] {
  const shapes: string[] = [];
  const visit = (left: string, right: string): boolean => {
    if (left === right) return true;
    const a = before.values[left];
    const b = after.values[right];
    if (!a || !b) return false;
    if (sameRoot(a, b)) return a.args.every((arg, i) => visit(arg, b.args[i]));

    if (a.type || b.type || a.args.length !== 2 || b.args.length !== 2) return false;
    if (a.op !== 'div' && a.op !== 'rem') return false;
    const div = a.op === 'div';
    const divisor = before.values[a.args[1]];
    const operand = after.values[b.args[1]];
    if (
      b.op !== (div ? 'shr' : 'and') ||
      divisor?.op !== 'const' ||
      operand?.op !== 'const' ||
      divisor.type ||
      operand.type ||
      typeof divisor.imm !== 'number' ||
      !isPow2(divisor.imm) ||
      operand.imm !== (div ? log2(divisor.imm) : divisor.imm - 1)
    ) return false;
    const premise = b.origin.some(
      origin =>
        origin.via === 'strength' &&
        origin.rev === after.rev &&
        origin.because?.some(reason => /^fact:ranges\(.* in \[\d+, \d+\]$/.test(reason)),
    );
    if (!premise || !visit(a.args[0], b.args[0])) return false;
    shapes.push(div ? 'div(x, 2^k) → shr(x, k) if x ≥ 0' : 'rem(x, 2^k) → and(x, 2^k − 1) if x ≥ 0');
    return true;
  };
  return visit(from, to) ? shapes : [];
}

/** Classify accepted built-in O2/speed edit records for one adjacent revision pair, in log order. */
export function classifyEdits(
  before: TypedBlocks,
  after: TypedBlocks,
  correspondence: EntityCorrespondence,
  edits: readonly Edit[],
): ClassifiedEdit[] {
  const footprint = statementFootprints(before, after, correspondence);
  const replayed = new Map<string, ReturnType<typeof replayTable>>();
  return edits.map(edit => {
    const base = { edit, statements: footprint(edit), rules: [], candidateShapes: [] };
    if (structural.has(edit.pass) || edit.kind === 'unreachable')
      return { ...base, classification: 'structural', reason: edit.pass };

    const from = text(edit.from);
    const to = text(edit.to);
    const stmt = text(edit.stmt);
    const field = fields.find(f => f === edit.field);
    if (edit.kind === 'replace' && stmt && field && from && to) {
      const sameSite = before.stmts[stmt]?.[field] === from && after.stmts[stmt]?.[field] === to;
      const table = tables.get(edit.pass);
      if (sameSite && table) {
        if (!replayed.has(edit.pass)) replayed.set(edit.pass, replayTable(before, after, edit.pass, table));
        const firings = replayed.get(edit.pass)?.get(`${stmt}/${field}`);
        if (firings?.size)
          return {
            ...base,
            classification: 'local',
            reason: 'table replay',
            rules: describeRules(table, firings, edit),
          };
      }
      if (sameSite && edit.pass === 'strength') {
        const candidateShapes = strengthShapes(before, after, from, to);
        if (candidateShapes.length)
          return { ...base, classification: 'local', reason: 'guarded i32 shape', candidateShapes };
      }

      const contextualShape = contextual.get(edit.pass);
      if (contextualShape)
        return { ...base, classification: 'other', reason: 'depends on a separate statement', contextualShape };
      return { ...base, classification: 'other', reason: 'unmatched value replacement' };
    }
    return { ...base, classification: 'other', reason: edit.kind };
  });
}
