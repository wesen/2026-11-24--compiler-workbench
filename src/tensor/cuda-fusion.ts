import { plain, type Affine, type Expr, type Fn, type Statement } from './model.js';

type Load = Extract<Expr, { kind: 'load' }>;
interface Read {
  consumer: Statement;
  load: Load;
  outerFold?: Expr & { kind: 'reduce' };
}

export type KernelGroup =
  | { kind: 'element'; statements: Statement[] }
  | { kind: 'row'; statements: Statement[]; columns: Affine; stagedInputs: string[] };

function sameDim(a: Affine, b: Affine): boolean {
  return (
    a.constant === b.constant &&
    a.terms.length === b.terms.length &&
    a.terms.every(([name, coefficient], i) => name === b.terms[i][0] && coefficient === b.terms[i][1])
  );
}

function reads(consumer: Statement): Read[] {
  const result: Read[] = [];
  function walk(expr: Expr, outerFold?: Read['outerFold']) {
    if (expr.kind === 'load') result.push({ consumer, load: expr, outerFold });
    if (expr.kind === 'op') expr.args.forEach(arg => walk(arg, outerFold));
    if (expr.kind === 'reduce') walk(expr.body, outerFold ?? expr);
  }
  walk(consumer.expr);
  return result;
}

/** Partition the ordered IR before emitting CUDA. Each group publishes only its last tensor. */
export function planCudaKernels(fn: Fn, fuse: boolean): KernelGroup[] {
  if (!fuse) return fn.statements.map(s => ({ kind: 'element', statements: [s] }));

  const uses = new Map(fn.statements.map(s => [s.name, [] as Read[]]));
  const inputShapes = new Map([...fn.params, ...fn.statements].map(t => [t.name, t.shape]));
  const statementReads = new Map(fn.statements.map(s => [s, reads(s)]));
  for (const entries of statementReads.values()) {
    for (const read of entries) uses.get(read.load.name)?.push(read);
  }

  function group(statements: Statement[]): KernelGroup | undefined {
    const last = statements[statements.length - 1];
    const members = new Set(statements);
    const internal: Read[] = [];
    for (const producer of statements.slice(0, -1)) {
      const consumers = uses.get(producer.name)!;
      if (producer.name === fn.result || !consumers.length || consumers.some(r => !members.has(r.consumer)))
        return;
      internal.push(...consumers);
    }
    const shape = last.shape;
    if (
      statements.every(
        s => s.shape.length === shape.length && s.shape.every((d, i) => sameDim(d, shape[i])),
      ) &&
      internal.every(
        ({ load, consumer, outerFold }) =>
          !outerFold && load.indices.every((d, i) => plain(d) === consumer.axes[i].id),
      )
    )
      return { kind: 'element', statements };

    const columns = statements.find(s => s.shape.length === 2)?.shape[1];
    if (
      !columns ||
      !statements.some(s => s.shape.length === 1) ||
      statements.some(
        s =>
          s.shape.length > 2 ||
          !sameDim(s.shape[0], shape[0]) ||
          (s.shape.length === 2 && !sameDim(s.shape[1], columns)),
      ) ||
      internal.some(({ load, consumer }) => plain(load.indices[0]) !== consumer.axes[0].id)
    )
      return;

    const localNames = new Set(statements.map(s => s.name));
    const stagedInputs = new Set<string>();
    for (const s of statements) {
      if (s.shape.length !== 1) continue;
      for (const { load, outerFold } of statementReads.get(s)!) {
        const input = inputShapes.get(load.name)!;
        const axis = outerFold?.axes[0];
        if (
          !localNames.has(load.name) &&
          input.length === 2 &&
          sameDim(input[0], shape[0]) &&
          sameDim(input[1], columns) &&
          plain(load.indices[0]) === s.axes[0].id &&
          outerFold?.axes.length === 1 &&
          axis?.extent.kind === 'dim' &&
          sameDim(axis.extent.dim, columns) &&
          plain(load.indices[1]) === axis.id
        )
          stagedInputs.add(load.name);
      }
    }
    return { kind: 'row', statements, columns, stagedInputs: [...stagedInputs] };
  }

  const groups: KernelGroup[] = [];
  const position = new Map(fn.statements.map((s, i) => [s, i]));
  // Starting at the end gives a producer with several local users a chance to fuse with all of them.
  for (let end = fn.statements.length; end > 0; ) {
    let chosen: KernelGroup = { kind: 'element', statements: fn.statements.slice(end - 1, end) };
    let earliest = end - 1;
    while (earliest > 0) {
      const s = fn.statements[earliest - 1];
      const consumers = uses.get(s.name)!;
      // Extending farther to the left cannot repair a use to the right of this group.
      if (s.name === fn.result || !consumers.length || consumers.some(r => position.get(r.consumer)! >= end))
        break;
      earliest--;
    }
    for (let start = earliest; start < end - 1; start++) {
      const candidate = group(fn.statements.slice(start, end));
      if (!candidate) continue;
      chosen = candidate;
      break;
    }
    groups.push(chosen);
    end -= chosen.statements.length;
  }
  return groups.reverse();
}
