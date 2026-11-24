import { assert, finite, positive } from '../core/types.js';

/** A deliberately small, scalar expression language. IDs are local to one DAG. */
export type ExprOp = 'constant' | 'variable' | 'add' | 'sub' | 'mul' | 'div' | 'neg' | 'sin' | 'cos' | 'sqrt';
export type ExprId = number;
export interface ExprNode {
  id: ExprId;
  op: ExprOp;
  args: ExprId[];
  value?: number;
  name?: string;
}
export interface Residual {
  id: string;
  expression: ExprId;
  /** A positive scale with the same units as the expression. */
  scale: number;
}
export interface ResidualProgram {
  nodes: ExprNode[];
  residuals: Residual[];
  variables: string[];
  parameters: string[];
}

export class ExprBuilder {
  readonly nodes: ExprNode[] = [];
  private readonly interned = new Map<string, ExprId>();

  private emit(op: ExprOp, args: ExprId[], extra: { value?: number; name?: string } = {}): ExprId {
    for (const arg of args) assert(Number.isInteger(arg) && arg >= 0 && arg < this.nodes.length, 'Expression operand is not in this builder');
    const key = JSON.stringify([op, args, extra]);
    const existing = this.interned.get(key);
    if (existing !== undefined) return existing;
    const id = this.nodes.length;
    this.nodes.push({ id, op, args, ...extra });
    this.interned.set(key, id);
    return id;
  }
  constant(value: number): ExprId { finite(value, 'constant'); return this.emit('constant', [], { value }); }
  variable(name: string): ExprId { assert(typeof name === 'string' && name.length > 0, 'Variable name must be nonempty'); return this.emit('variable', [], { name }); }
  add(a: ExprId, b: ExprId): ExprId { return this.emit('add', [a, b]); }
  sub(a: ExprId, b: ExprId): ExprId { return this.emit('sub', [a, b]); }
  mul(a: ExprId, b: ExprId): ExprId { return this.emit('mul', [a, b]); }
  div(a: ExprId, b: ExprId): ExprId { return this.emit('div', [a, b]); }
  neg(a: ExprId): ExprId { return this.emit('neg', [a]); }
  sin(a: ExprId): ExprId { return this.emit('sin', [a]); }
  cos(a: ExprId): ExprId { return this.emit('cos', [a]); }
  sqrt(a: ExprId): ExprId { return this.emit('sqrt', [a]); }
  square(a: ExprId): ExprId { return this.mul(a, a); }
}

export function residualProgram(builder: ExprBuilder, residuals: Array<{ id: string; expression: ExprId; scale?: number }>, variables: string[], parameters: string[] = []): ResidualProgram {
  const program: ResidualProgram = {
    nodes: builder.nodes.map(n => ({ ...n, args: [...n.args] })),
    residuals: residuals.map(r => ({ ...r, scale: r.scale ?? 1 })),
    variables: [...variables], parameters: [...parameters],
  };
  validateResidualProgram(program);
  return program;
}

const ARITY: Record<ExprOp, number> = { constant: 0, variable: 0, add: 2, sub: 2, mul: 2, div: 2, neg: 1, sin: 1, cos: 1, sqrt: 1 };

export function validateResidualProgram(value: unknown): asserts value is ResidualProgram {
  assert(value !== null && typeof value === 'object', 'Residual program must be an object');
  const p = value as ResidualProgram;
  assert(Array.isArray(p.nodes) && Array.isArray(p.residuals) && Array.isArray(p.variables) && Array.isArray(p.parameters), 'Malformed residual program');
  assert(p.residuals.length > 0 && p.variables.length > 0, 'A constraint system needs residuals and unknowns');
  const names = [...p.variables, ...p.parameters];
  assert(names.every(n => typeof n === 'string' && n.length > 0) && new Set(names).size === names.length, 'Variables and parameters must have distinct names');
  p.nodes.forEach((n, i) => {
    assert(n !== null && typeof n === 'object' && n.id === i && Object.hasOwn(ARITY, n.op), 'Expression IDs must be contiguous and operations supported');
    assert(Array.isArray(n.args) && n.args.length === ARITY[n.op], 'Wrong expression arity');
    assert(n.args.every(a => Number.isInteger(a) && a >= 0 && a < i), 'Expression graph must be topologically ordered and acyclic');
    if (n.op === 'constant') finite(n.value, 'Expression constant');
    if (n.op === 'variable') assert(typeof n.name === 'string' && names.includes(n.name), `Undeclared variable ${String(n.name)}`);
  });
  assert(new Set(p.residuals.map(r => r.id)).size === p.residuals.length, 'Residual IDs must be distinct');
  for (const r of p.residuals) {
    assert(typeof r.id === 'string' && r.id.length > 0, 'Residual needs an ID');
    assert(Number.isInteger(r.expression) && r.expression >= 0 && r.expression < p.nodes.length, 'Residual root is missing');
    positive(r.scale, 'Residual scale');
  }
}

export interface Instruction {
  op: ExprOp;
  args: number[];
  origins: ExprId[];
  value?: number;
  name?: string;
}
export interface NumericTape {
  instructions: Instruction[];
  outputs: Array<{ id: string; register: number; scale: number }>;
  variables: string[];
  parameters: string[];
  sourceNodeCount: number;
  eliminatedNodeCount: number;
  foldedNodeCount: number;
}

/** Dead-node elimination, exact constant folding, and structural interning. No reassociation. */
export function compileTape(program: ResidualProgram): NumericTape {
  validateResidualProgram(program);
  const live = new Set<number>();
  const mark = (id: number): void => { if (live.has(id)) return; live.add(id); for (const a of program.nodes[id].args) mark(a); };
  for (const r of program.residuals) mark(r.expression);
  const instructions: Instruction[] = [];
  const registers = new Map<number, number>();
  const interning = new Map<string, number>();
  let foldedNodeCount = 0;
  for (const node of program.nodes) {
    if (!live.has(node.id)) continue;
    const args = node.args.map(a => registers.get(a)!);
    let instruction: Instruction = { op: node.op, args, origins: [node.id] };
    if (node.op === 'constant') instruction.value = node.value!;
    if (node.op === 'variable') instruction.name = node.name!;
    if (node.op !== 'constant' && node.op !== 'variable' && args.every(a => instructions[a].op === 'constant')) {
      const a = instructions[args[0]].value!;
      const b = args.length > 1 ? instructions[args[1]].value! : 0;
      const value = primal(node.op, a, b);
      finite(value, `Constant-folded expression ${node.id}`);
      instruction = { op: 'constant', args: [], origins: [node.id], value };
      foldedNodeCount++;
    }
    const { origins: _origins, ...keyFields } = instruction;
    const key = JSON.stringify(keyFields);
    let register = interning.get(key);
    if (register === undefined) { register = instructions.length; instructions.push(instruction); interning.set(key, register); }
    else instructions[register].origins.push(node.id);
    registers.set(node.id, register);
  }
  return { instructions, outputs: program.residuals.map(r => ({ id: r.id, register: registers.get(r.expression)!, scale: r.scale })), variables: [...program.variables], parameters: [...program.parameters], sourceNodeCount: program.nodes.length, eliminatedNodeCount: program.nodes.length - live.size, foldedNodeCount };
}

function primal(op: ExprOp, a: number, b: number): number {
  switch (op) {
    case 'add': return a + b;
    case 'sub': return a - b;
    case 'mul': return a * b;
    case 'div': assert(b !== 0, 'Division by zero in expression'); return a / b;
    case 'neg': return -a;
    case 'sin': return Math.sin(a);
    case 'cos': return Math.cos(a);
    case 'sqrt': assert(a >= 0, 'Negative square root in expression'); return Math.sqrt(a);
    default: throw new Error(`Cannot evaluate ${op} as arithmetic`);
  }
}

export interface TapeEvaluation {
  residuals: number[];
  jacobian: number[][];
  /** Counted primal + forward derivative arithmetic and transcendental evaluations. */
  scalarOperations: number;
}

export function validateNumericTape(value: unknown): asserts value is NumericTape {
  assert(value !== null && typeof value === 'object', 'Numeric tape must be an object');
  const t = value as NumericTape;
  assert(Array.isArray(t.instructions) && Array.isArray(t.outputs) && Array.isArray(t.variables) && Array.isArray(t.parameters), 'Malformed numeric tape');
  const names = [...t.variables, ...t.parameters];
  assert(t.variables.length > 0 && t.outputs.length > 0 && names.every(n => typeof n === 'string' && n.length > 0) && new Set(names).size === names.length, 'Invalid tape variable names');
  t.instructions.forEach((n, i) => {
    assert(n !== null && typeof n === 'object' && Object.hasOwn(ARITY, n.op) && Array.isArray(n.args) && n.args.length === ARITY[n.op], 'Invalid tape instruction');
    assert(n.args.every(a => Number.isInteger(a) && a >= 0 && a < i), 'Invalid tape operand');
    assert(Array.isArray(n.origins) && n.origins.every(a => Number.isInteger(a) && a >= 0), 'Invalid tape origin');
    if (n.op === 'constant') finite(n.value, 'Tape constant');
    if (n.op === 'variable') assert(typeof n.name === 'string' && names.includes(n.name), 'Undeclared tape input');
  });
  for (const o of t.outputs) {
    assert(typeof o.id === 'string' && Number.isInteger(o.register) && o.register >= 0 && o.register < t.instructions.length, 'Invalid tape output');
    positive(o.scale, 'Output scale');
  }
  for (const key of ['sourceNodeCount', 'eliminatedNodeCount', 'foldedNodeCount'] as const) assert(Number.isInteger(t[key]) && t[key] >= 0, `Invalid ${key}`);
}

/** Forward automatic differentiation, with an explicit unknown/parameter partition. */
export function evaluateTape(tape: NumericTape, inputs: Readonly<Record<string, number>>): TapeEvaluation {
  const width = tape.variables.length;
  for (const name of [...tape.variables, ...tape.parameters]) finite(inputs[name], `Input ${name}`);
  const slots: number[] = [];
  const derivatives: number[][] = [];
  let scalarOperations = 0;
  for (const instruction of tape.instructions) {
    const grad = new Array<number>(width).fill(0);
    let result: number;
    if (instruction.op === 'constant') result = instruction.value!;
    else if (instruction.op === 'variable') {
      result = inputs[instruction.name!];
      const column = tape.variables.indexOf(instruction.name!);
      if (column >= 0) grad[column] = 1;
    } else {
      const ai = instruction.args[0], bi = instruction.args[1];
      const a = slots[ai], b = bi === undefined ? 0 : slots[bi];
      const da = derivatives[ai], db = bi === undefined ? [] : derivatives[bi];
      result = primal(instruction.op, a, b);
      scalarOperations++;
      let factor = 0;
      if (instruction.op === 'sin') { factor = Math.cos(a); scalarOperations++; }
      if (instruction.op === 'cos') { factor = -Math.sin(a); scalarOperations += 2; }
      if (instruction.op === 'sqrt') {
        assert(result > 0, 'Undefined derivative of sqrt at zero');
        factor = 0.5 / result; scalarOperations++;
      }
      for (let j = 0; j < width; j++) {
        switch (instruction.op) {
          case 'add': grad[j] = da[j] + db[j]; scalarOperations++; break;
          case 'sub': grad[j] = da[j] - db[j]; scalarOperations++; break;
          case 'mul': grad[j] = da[j] * b + a * db[j]; scalarOperations += 3; break;
          case 'div': grad[j] = (da[j] * b - a * db[j]) / (b * b); scalarOperations += 5; break;
          case 'neg': grad[j] = -da[j]; scalarOperations++; break;
          case 'sin': case 'cos': case 'sqrt': grad[j] = factor * da[j]; scalarOperations++; break;
        }
        finite(grad[j], 'Expression derivative');
      }
    }
    finite(result, 'Expression result');
    slots.push(result); derivatives.push(grad);
  }
  const residuals: number[] = [], jacobian: number[][] = [];
  for (const output of tape.outputs) {
    residuals.push(slots[output.register] / output.scale);
    jacobian.push(derivatives[output.register].map(d => d / output.scale));
    scalarOperations += width + 1;
  }
  return { residuals, jacobian, scalarOperations };
}
