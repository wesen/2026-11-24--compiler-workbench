import { canonical } from '../core/data.js';
import type { AlgorithmKind, AlgorithmRef, StrategyPlan, ValidationIssue, ValidationResult } from './ir.js';
import type { AlgorithmRegistry } from './registry.js';

const kinds = [
  'apply',
  'sequence',
  'parallel',
  'fork',
  'chooseBest',
  'conditional',
  'repeatUntilStable',
  'forEach',
  'require',
  'verify',
  'checkpoint',
  'attempt',
  'scope',
];
const names = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const positiveInteger = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;
const fields: Record<string, string[]> = {
  apply: ['algorithm', 'args', 'input'],
  sequence: ['steps'],
  parallel: ['steps', 'concurrency'],
  fork: ['branches', 'concurrency'],
  chooseBest: ['candidates', 'objective', 'constraints', 'metrics', 'args', 'decisionAs'],
  conditional: ['predicate', 'then', 'else', 'args', 'input'],
  repeatUntilStable: ['body', 'maxIterations', 'identity'],
  forEach: ['body', 'selector', 'items', 'args', 'input', 'maxItems', 'concurrency'],
  require: ['analysis', 'as', 'args', 'input'],
  verify: ['invariant', 'code', 'args', 'input'],
  checkpoint: ['name', 'data'],
  attempt: ['body', 'fallback', 'codes'],
  scope: ['name', 'body'],
};
export function validate(value: unknown, registry?: AlgorithmRegistry): ValidationResult {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, code: string, message: string, nodeId?: string) =>
    issues.push({ path, code, message, ...(nodeId ? { nodeId } : {}) });
  try {
    canonical(value);
  } catch (e) {
    issue('$', 'non-json', e instanceof Error ? e.message : String(e));
    return { valid: false, issues };
  }
  const exact = (v: Record<string, unknown>, allowed: string[], path: string) => {
    for (const k of Object.keys(v))
      if (!allowed.includes(k)) issue(`${path}.${k}`, 'unknown-field', `Unexpected field ${k}`);
  };
  if (!record(value)) {
    issue('$', 'plan-shape', 'Strategy plan must be a record');
    return { valid: false, issues };
  }
  exact(value, ['formatVersion', 'id', 'root', 'description', 'requirements'], '$');
  if (value.formatVersion !== 1)
    issue('$.formatVersion', 'format-version', 'Expected Strategy IR formatVersion 1');
  if (!names(value.id)) issue('$.id', 'plan-id', 'Plan id must be nonempty');
  if (value.description !== undefined && typeof value.description !== 'string')
    issue('$.description', 'description', 'Description must be text');
  const seen = new Set<string>();
  let count = 0;
  function alg(v: unknown, kind: AlgorithmKind | undefined, path: string) {
    if (!record(v) || !names(v.id) || !names(v.version)) {
      issue(path, 'algorithm-ref', 'Expected a nonempty algorithm id and exact version');
      return;
    }
    exact(v, ['id', 'version'], path);
    if (registry)
      try {
        registry.get(v as unknown as AlgorithmRef, kind);
      } catch (e) {
        issue(path, 'algorithm-unavailable', e instanceof Error ? e.message : String(e));
      }
  }
  if (value.requirements !== undefined) {
    if (!Array.isArray(value.requirements))
      issue('$.requirements', 'requirements', 'Requirements must be an array of exact algorithm references');
    else {
      const seenRequirements = new Set<string>();
      value.requirements.forEach((r, i) => {
        const path = `$.requirements[${i}]`;
        alg(r, undefined, path);
        const key = canonical(r);
        if (seenRequirements.has(key))
          issue(path, 'duplicate-requirement', 'Duplicate algorithm requirement');
        seenRequirements.add(key);
      });
    }
  }
  function template(
    v: unknown,
    path: string,
    bindings: Set<string>,
    context: { item: boolean; iteration: boolean },
    depth = 0,
  ) {
    if (depth > 128) {
      issue(path, 'template-depth', 'Template exceeds depth 128');
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => template(x, `${path}[${i}]`, bindings, context, depth + 1));
      return;
    }
    if (!record(v)) return;
    if (Object.hasOwn(v, '$literal')) {
      exact(v, ['$literal'], path);
      return;
    }
    if (Object.hasOwn(v, '$ref')) {
      exact(v, ['$ref', 'path', 'name'], path);
      if (!['input', 'current', 'binding', 'item', 'index', 'iteration'].includes(v.$ref as string))
        issue(path, 'reference-source', 'Unknown reference source');
      if (v.$ref === 'binding') {
        if (!names(v.name)) issue(path, 'binding-name', 'Binding reference needs a name');
        else if (!bindings.has(v.name))
          issue(path, 'unbound-reference', `Binding ${v.name} is not available in this lexical scope`);
      } else if (v.name !== undefined) issue(path, 'reference-name', 'Only binding references accept name');
      if ((v.$ref === 'item' || v.$ref === 'index') && !context.item)
        issue(path, 'unbound-reference', `${v.$ref} is only available in forEach bodies`);
      if (v.$ref === 'iteration' && !context.iteration)
        issue(path, 'unbound-reference', 'iteration is only available in repeat bodies');
      if (v.path !== undefined) {
        if (
          !Array.isArray(v.path) ||
          v.path.some(k => !(typeof k === 'string' || (Number.isSafeInteger(k) && (k as number) >= 0)))
        )
          issue(
            path,
            'reference-path',
            'Reference path must contain string keys or nonnegative integer indices',
          );
        else if (v.path.some(k => ['__proto__', 'prototype', 'constructor'].includes(String(k))))
          issue(path, 'unsafe-path', 'Prototype path segments are forbidden');
      }
      return;
    }
    for (const [k, x] of Object.entries(v)) template(x, `${path}.${k}`, bindings, context, depth + 1);
  }
  function node(
    v: unknown,
    path: string,
    bindings: Set<string>,
    context: { item: boolean; iteration: boolean },
    depth: number,
  ): void {
    if (++count > 10000) {
      if (count === 10001) issue(path, 'node-budget', 'Plan exceeds 10000 static nodes');
      return;
    }
    if (depth > 128) {
      issue(path, 'node-depth', 'Plan exceeds depth 128');
      return;
    }
    if (!record(v)) {
      issue(path, 'node-shape', 'Strategy node must be a record');
      return;
    }
    if (!names(v.id)) issue(`${path}.id`, 'node-id', 'Node id must be nonempty');
    else if (seen.has(v.id)) issue(`${path}.id`, 'duplicate-id', `Duplicate strategy node id ${v.id}`, v.id);
    else seen.add(v.id);
    if (!kinds.includes(v.kind as string)) {
      issue(`${path}.kind`, 'node-kind', 'Unknown strategy node kind');
      return;
    }
    const kind = v.kind as string;
    exact(v, ['id', 'kind', 'bind', 'label', ...fields[kind]], path);
    if (v.bind !== undefined && !names(v.bind))
      issue(`${path}.bind`, 'binding-name', 'bind must be nonempty');
    if (v.label !== undefined && typeof v.label !== 'string')
      issue(`${path}.label`, 'label', 'label must be text');
    for (const f of ['args', 'input', 'items', 'data'])
      if (v[f] !== undefined) template(v[f], `${path}.${f}`, bindings, context);
    if (v.concurrency !== undefined && !positiveInteger(v.concurrency))
      issue(`${path}.concurrency`, 'concurrency', 'Concurrency must be a positive integer');
    const child = (x: unknown, slot: string, ctx = context) =>
      node(x, `${path}.${slot}`, new Set(bindings), ctx, depth + 1);
    switch (kind) {
      case 'apply':
        alg(v.algorithm, 'transform', `${path}.algorithm`);
        break;
      case 'sequence':
        if (!Array.isArray(v.steps)) issue(`${path}.steps`, 'steps', 'Sequence steps must be an array');
        else {
          const local = new Set(bindings);
          v.steps.forEach((x, i) => node(x, `${path}.steps[${i}]`, local, context, depth + 1));
        }
        break;
      case 'parallel':
        if (!Array.isArray(v.steps)) issue(`${path}.steps`, 'steps', 'Parallel steps must be an array');
        else v.steps.forEach((x, i) => child(x, `steps[${i}]`));
        break;
      case 'fork':
        if (!Array.isArray(v.branches) || !v.branches.length)
          issue(`${path}.branches`, 'branches', 'Fork needs at least one named branch');
        else {
          const branchNames = new Set<string>();
          v.branches.forEach((b, i) => {
            const p = `${path}.branches[${i}]`;
            if (!record(b)) {
              issue(p, 'branch-shape', 'Branch must be a record');
              return;
            }
            exact(b, ['name', 'strategy'], p);
            if (!names(b.name) || branchNames.has(b.name))
              issue(p, 'branch-name', 'Branch names must be nonempty and unique');
            else branchNames.add(b.name);
            child(b.strategy, `branches[${i}].strategy`);
          });
        }
        break;
      case 'chooseBest':
        child(v.candidates, 'candidates');
        if (
          !record(v.objective) ||
          !names(v.objective.metric) ||
          !['min', 'max'].includes(v.objective.direction as string)
        )
          issue(`${path}.objective`, 'objective', 'Objective needs metric and min/max direction');
        else exact(v.objective, ['metric', 'direction'], `${path}.objective`);
        if (!Array.isArray(v.constraints))
          issue(`${path}.constraints`, 'constraints', 'Constraints must be an array');
        else
          v.constraints.forEach((c, i) => {
            const p = `${path}.constraints[${i}]`;
            if (
              !record(c) ||
              !names(c.metric) ||
              !['<=', '>=', '<', '>', '=='].includes(c.op as string) ||
              typeof c.value !== 'number' ||
              !Number.isFinite(c.value)
            )
              issue(p, 'constraint', 'Invalid numeric metric constraint');
            else exact(c, ['metric', 'op', 'value'], p);
          });
        if (v.metrics !== undefined) alg(v.metrics, 'metrics', `${path}.metrics`);
        if (v.decisionAs !== undefined) {
          if (!names(v.decisionAs))
            issue(`${path}.decisionAs`, 'binding-name', 'decisionAs must be nonempty');
          else {
            if (v.decisionAs === v.bind)
              issue(
                `${path}.decisionAs`,
                'binding-conflict',
                'decisionAs and bind must name distinct bindings',
              );
            bindings.add(v.decisionAs);
          }
        }
        break;
      case 'conditional':
        alg(v.predicate, 'predicate', `${path}.predicate`);
        child(v.then, 'then');
        child(v.else, 'else');
        break;
      case 'repeatUntilStable':
        if (!positiveInteger(v.maxIterations))
          issue(`${path}.maxIterations`, 'iteration-bound', 'maxIterations must be a positive integer');
        if (v.identity !== undefined) alg(v.identity, 'analysis', `${path}.identity`);
        child(v.body, 'body', { ...context, iteration: true });
        break;
      case 'forEach':
        if (!positiveInteger(v.maxItems))
          issue(`${path}.maxItems`, 'item-bound', 'maxItems must be a positive integer');
        if (v.selector !== undefined) alg(v.selector, 'selector', `${path}.selector`);
        if (v.selector !== undefined && v.items !== undefined)
          issue(path, 'selector-conflict', 'forEach accepts either selector or items, not both');
        child(v.body, 'body', { ...context, item: true });
        break;
      case 'require':
        alg(v.analysis, 'analysis', `${path}.analysis`);
        if (!names(v.as)) issue(`${path}.as`, 'binding-name', 'require needs an analysis binding name');
        else bindings.add(v.as);
        break;
      case 'verify':
        alg(v.invariant, 'invariant', `${path}.invariant`);
        if (v.code !== undefined && !names(v.code))
          issue(`${path}.code`, 'rejection-code', 'Verification rejection code must be nonempty');
        break;
      case 'checkpoint':
        if (!names(v.name)) issue(`${path}.name`, 'checkpoint-name', 'Checkpoint needs a nonempty name');
        break;
      case 'attempt':
        if (
          v.codes !== undefined &&
          (!Array.isArray(v.codes) ||
            v.codes.some(x => !names(x)) ||
            new Set(v.codes as string[]).size !== (v.codes as string[]).length)
        )
          issue(`${path}.codes`, 'rejection-codes', 'Recovery codes must be unique nonempty strings');
        child(v.body, 'body');
        child(v.fallback, 'fallback');
        break;
      case 'scope':
        if (!names(v.name)) issue(`${path}.name`, 'scope-name', 'Scope needs a nonempty name');
        child(v.body, 'body');
        break;
    }
    if (names(v.bind)) bindings.add(v.bind);
  }
  node(value.root, '$.root', new Set(), { item: false, iteration: false }, 0);
  return { valid: issues.length === 0, issues };
}
export class PlanValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map(i => `${i.path}: ${i.message}`).join('\n'));
    this.name = 'PlanValidationError';
    this.issues = issues;
  }
}
export function assertValid(value: unknown, registry?: AlgorithmRegistry): asserts value is StrategyPlan {
  const result = validate(value, registry);
  if (!result.valid) throw new PlanValidationError(result.issues);
}
