import {
  addScaled,
  numericLiteral,
  identifier,
  constant,
  equalForm,
  equalShape,
  variable,
  type Affine,
  type Axis,
  type Binary,
  type Definition,
  type Expr,
  type TensorDecl,
  type TensorFn,
  type TensorModule,
  type UnaryCall,
} from './model.js';
import { checkModule } from './ir.js';

interface Token {
  text: string;
  line: number;
  col: number;
}
function error(t: Token, message: string): never {
  throw new Error(`${t.line}:${t.col}: ${message}`);
}
function lex(source: string): Token[] {
  const token =
    /(?:\/\/[^\r\n]*|\s+|[A-Za-z_][A-Za-z_0-9]*|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?|[(){}\[\]:;,=+*\/-])/gy;
  let line = 1,
    col = 1,
    pos = 0;
  const out: Token[] = [];
  while (pos < source.length) {
    const text = token.exec(source)?.[0];
    if (!text) error({ text: '', line, col }, `unexpected character ${source[pos]}`);
    if (!(text.startsWith('//') || /^\s/.test(text))) out.push({ text, line, col });
    const lines = text.split(/\r\n|[\r\n]/);
    line += lines.length - 1;
    col = lines.length === 1 ? col + text.length : 1 + lines[lines.length - 1].length;
    pos += text.length;
  }
  out.push({ text: '<end>', line, col });
  return out;
}

interface Binder {
  token: Token;
  id: string;
  extent?: Affine;
}
type Scope = Map<string, Binder>;
class Parser {
  private at = 0;
  private nextId = 0;
  private shapes = new Map<string, Token>();
  private anchors = new Set<string>();
  private tensors = new Map<string, TensorDecl>();
  private locations = new WeakMap<object, Token>();
  // Only max(shape,shape) followed by minus has two syntactically viable readings.
  private ambiguous: number[] = [];
  private asReduction = new Set<number>();

  constructor(private tokens: Token[]) {}
  private get here(): Token {
    return this.tokens[this.at];
  }
  private take(text: string): boolean {
    if (this.here.text !== text) return false;
    this.at++;
    return true;
  }
  private expect(text: string) {
    if (!this.take(text)) error(this.here, `expected '${text}'`);
  }
  private name(): Token {
    const t = this.here;
    if (!identifier.test(t.text)) error(t, 'expected a name');
    this.at++;
    return t;
  }
  private list<T>(item: () => T): T[] {
    const result = [item()];
    while (this.take(',')) result.push(item());
    return result;
  }
  private located<T extends object>(value: T, t: Token): T {
    this.locations.set(value, t);
    return value;
  }

  parse(): TensorModule {
    const functions: TensorFn[] = [],
      names = new Set<string>();
    do {
      const t = this.here,
        fn = this.fn();
      if (names.has(fn.name)) error(t, `duplicate function ${fn.name}`);
      names.add(fn.name);
      functions.push(fn);
    } while (this.here.text !== '<end>');
    const mod = { functions };
    checkModule(mod, (node, why) => error(this.locations.get(node) ?? this.tokens[0], why));
    return mod;
  }
  private fn(): TensorFn {
    this.shapes.clear();
    this.anchors.clear();
    this.tensors.clear();
    this.nextId = 0;
    this.expect('fn');
    const t = this.name();
    this.expect('(');
    const params = this.list(() => {
      const param = this.name();
      this.expect(':');
      const decl = this.located({ name: param.text, shape: this.type(true) }, param);
      this.define(decl, param);
      return decl;
    });
    this.expect(')');
    for (const [name, token] of this.shapes)
      if (!this.anchors.has(name)) error(token, `no bare input axis binds ${name}`);
    this.expect(':');
    const resultShape = this.type(false);
    this.expect('{');
    const definitions: Definition[] = [];
    while (!this.take('return')) {
      const def = this.statement();
      this.define(def, this.locations.get(def)!);
      definitions.push(def);
    }
    const result = this.name(),
      decl = this.tensors.get(result.text);
    if (!decl || !equalShape(decl.shape, resultShape))
      error(result, 'unknown return tensor or incompatible return shape');
    this.expect(';');
    this.expect('}');
    return this.located(
      {
        name: t.text,
        params,
        symbols: [...this.shapes.keys()],
        definitions,
        result: result.text,
        resultShape,
      },
      t,
    );
  }
  private define(d: TensorDecl, t: Token) {
    if (this.tensors.has(d.name)) error(t, `tensor ${d.name} is already defined`);
    this.tensors.set(d.name, d);
  }
  private type(param: boolean): Affine[] {
    this.expect('f32');
    this.expect('[');
    const dims = this.list(() => {
      const start = this.at,
        t = this.here;
      const dim = this.affine(n => {
        if (param && !this.shapes.has(n.text)) this.shapes.set(n.text, n);
        if (!this.shapes.has(n.text)) error(n, `unknown shape ${n.text}`);
        return n.text;
      });
      if (param && this.at === start + 1 && identifier.test(t.text)) this.anchors.add(t.text);
      return this.located(dim, t);
    });
    this.expect(']');
    return dims;
  }
  private affine(resolve: (t: Token) => string, precedence = 0): Affine {
    const t = this.here;
    let value: Affine;
    if (this.take('-')) value = addScaled(constant(0), this.affine(resolve, 3), -1);
    else if (this.take('(')) {
      value = this.affine(resolve);
      this.expect(')');
    } else if (/^\d+$/.test(t.text)) {
      this.at++;
      value = constant(Number(t.text));
    } else value = variable(resolve(this.name()));
    for (;;) {
      const op = this.here,
        level = op.text === '*' ? 2 : ['+', '-'].includes(op.text) ? 1 : 0;
      if (level <= precedence) break;
      this.at++;
      const right = this.affine(resolve, level);
      if (op.text === '*') {
        if (value.terms.length && right.terms.length) error(op, 'non-affine multiplication');
        value = value.terms.length
          ? addScaled(constant(0), value, right.constant)
          : addScaled(constant(0), right, value.constant);
      } else value = addScaled(value, right, op.text === '-' ? -1 : 1);
    }
    if (!Number.isSafeInteger(value.constant) || value.terms.some(([, n]) => !Number.isSafeInteger(n)))
      error(t, 'affine integer out of range');
    return value;
  }
  private binders(scope: Scope): Binder[] {
    const local = new Set<string>();
    return this.list(() => {
      const t = this.name();
      if (local.has(t.text)) error(t, `duplicate index ${t.text}`);
      local.add(t.text);
      const b = { token: t, id: `i${this.nextId++}` };
      scope.set(t.text, b);
      return b;
    });
  }
  private axis(b: Binder): Axis {
    if (!b.extent) error(b.token, `cannot infer extent for ${b.token.text}`);
    return { id: b.id, extent: b.extent };
  }
  private statement(): Definition {
    const start = this.at,
      firstId = this.nextId;
    this.asReduction.clear();
    for (;;) {
      this.at = start;
      this.nextId = firstId;
      this.ambiguous = [];
      try {
        const t = this.name(),
          scope: Scope = new Map();
        this.expect('[');
        const free = this.binders(scope);
        this.expect(']');
        if (this.take(':')) {
          const shape = this.type(false);
          if (shape.length !== free.length) error(t, 'declared rank differs from LHS rank');
          free.forEach((b, i) => {
            b.extent = shape[i];
          });
        }
        this.expect('=');
        const body = this.expression(scope);
        this.expect(';');
        const axes = free.map(b => this.axis(b));
        return this.located({ name: t.text, shape: axes.map(a => a.extent), axes, body }, t);
      } catch (e) {
        const fallback = this.ambiguous.pop();
        if (fallback === undefined) throw e;
        for (const pos of this.asReduction) if (pos > fallback) this.asReduction.delete(pos);
        this.asReduction.add(fallback);
      }
    }
  }
  private expression(scope: Scope, precedence = 0): Expr {
    let left = this.prefix(scope);
    for (;;) {
      const op = this.here.text,
        level = ['*', '/'].includes(op) ? 2 : ['+', '-'].includes(op) ? 1 : 0;
      if (level <= precedence) return left;
      this.at++;
      left = { kind: 'binary', op: op as Binary, left, right: this.expression(scope, level) };
    }
  }
  private reductionHeader(): boolean {
    let i = this.at;
    const names: string[] = [];
    while (identifier.test(this.tokens[i].text)) {
      names.push(this.tokens[i++].text);
      if (this.tokens[i].text !== ',') break;
      i++;
    }
    if (this.tokens[i].text !== ')' || !names.length) return false;
    const body = this.tokens[i + 1].text;
    if (!(identifier.test(body) || numericLiteral.test(body) || body === '(' || body === '-')) return false;
    if (
      body === '-' &&
      names.length === 2 &&
      names.every(n => this.shapes.has(n)) &&
      !this.asReduction.has(this.at)
    ) {
      this.ambiguous.push(this.at);
      return false;
    }
    return true;
  }
  private prefix(scope: Scope): Expr {
    const t = this.here;
    if (this.take('-')) return { kind: 'neg', arg: this.expression(scope, 3) };
    if (this.take('(')) {
      const e = this.expression(scope);
      this.expect(')');
      return e;
    }
    if (numericLiteral.test(t.text)) {
      this.at++;
      return { kind: 'literal', text: t.text };
    }
    const name = this.name().text;
    if (this.take('[')) {
      const tensor = this.tensors.get(name);
      if (!tensor) error(t, `unknown tensor ${name}`);
      let axis = 0;
      const indices = this.list(() => {
        const start = this.at,
          token = this.here,
          extent = tensor.shape[axis++];
        if (!extent) error(token, `too many indices for ${name}`);
        const sub = this.affine(n => scope.get(n.text)?.id ?? error(n, `unbound index ${n.text}`));
        if (this.at === start + 1 && scope.has(token.text)) {
          const b = scope.get(token.text)!;
          if (b.extent && !equalForm(b.extent, extent))
            error(token, `incompatible extents for ${token.text}`);
          b.extent = extent;
        }
        return sub;
      });
      this.expect(']');
      if (axis !== tensor.shape.length) error(t, `wrong rank for ${name}`);
      return this.located({ kind: 'read' as const, tensor: name, indices }, t);
    }
    if (!this.take('(')) {
      if (!this.shapes.has(name)) error(t, `unknown shape value ${name}`);
      return { kind: 'shape', name };
    }
    if (name === 'sum' || (name === 'max' && this.reductionHeader())) {
      const inner = new Map(scope),
        bound = this.binders(inner);
      this.expect(')');
      const body = this.expression(inner);
      return { kind: 'fold', op: name, axes: bound.map(b => ({ ...this.axis(b), kind: 'full' })), body };
    }
    const arg = this.expression(scope);
    if (name === 'min' || name === 'max') {
      this.expect(',');
      const right = this.expression(scope);
      this.expect(')');
      return { kind: 'binary', op: name, left: arg, right };
    }
    if (!['exp', 'log', 'sqrt', 'tanh'].includes(name)) error(t, `unknown call ${name}`);
    this.expect(')');
    return { kind: name as UnaryCall, arg };
  }
}
export const parseTix = (source: string): TensorModule => new Parser(lex(source)).parse();
