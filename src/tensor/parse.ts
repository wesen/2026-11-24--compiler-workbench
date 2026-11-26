import { add, constant, equal, scale, variable, type Affine } from './affine.js';
import {
  arity,
  errorAt,
  literalPattern,
  namePattern,
  sameShape,
  type Binder,
  type Definition,
  type Expr,
  type Location,
  type Operator,
  type Parameter,
  type TensorFunction,
  type TensorModule,
} from './ir.js';

interface Token extends Location {
  readonly text: string;
}
const eof = '<end>';

function scan(source: string): Token[] {
  const tokens: Token[] = [];
  const lex =
    /\/\/[^\r\n]*|\r\n|[\r\n]|[^\S\r\n]+|[a-zA-Z_][a-zA-Z_0-9]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[()[\]{},:;=+*/-]/y;
  let line = 1,
    col = 1,
    offset = 0;
  while (offset < source.length) {
    lex.lastIndex = offset;
    const text = lex.exec(source)?.[0];
    if (!text) throw errorAt({ line, col }, `unexpected character ${JSON.stringify(source[offset])}`);
    if (text[0] === '\r' || text[0] === '\n') {
      line++;
      col = 1;
    } else {
      if (!text.startsWith('//') && !/^\s/.test(text)) tokens.push({ text, line, col });
      col += text.length;
    }
    offset = lex.lastIndex;
  }
  tokens.push({ text: eof, line, col });
  return tokens;
}

interface PendingBinder {
  readonly id: string;
  readonly at: Location;
  readonly name: string;
  extent?: Affine;
}
type Scope = ReadonlyMap<string, PendingBinder>;
const location = ({ line, col }: Token): Location => ({ line, col });
const precedence = (text: string) =>
  text === '+' || text === '-' ? 1 : text === '*' || text === '/' ? 2 : 0;

class Parser {
  private pos = 0;
  private serial = 0;
  private readonly tensors = new Map<string, Parameter>();
  private readonly shapeNames = new Set<string>();
  constructor(private readonly tokens: readonly Token[]) {}
  private peek() {
    return this.tokens[this.pos];
  }
  private take() {
    return this.tokens[this.pos++];
  }
  private accept(text: string) {
    if (this.peek().text === text) return this.take();
  }
  private expect(text: string) {
    return this.accept(text) ?? this.fail(this.peek(), `expected '${text}'`);
  }
  private fail(t: Token, msg: string): never {
    throw errorAt(t, msg);
  }
  private name() {
    const t = this.peek();
    return namePattern.test(t.text) && !['fn', 'return', 'f32'].includes(t.text)
      ? this.take()
      : this.fail(t, 'expected a name');
  }
  private node(t: Token) {
    return { id: `n${this.serial++}`, at: location(t) };
  }
  private list<T>(end: string, item: () => T): T[] {
    const items = [item()];
    while (this.accept(',')) items.push(item());
    this.expect(end);
    return items;
  }
  private affine(resolve: (t: Token) => string, min = 1): Affine {
    const t = this.take();
    let a: Affine;
    if (t.text === '-' || t.text === '+') a = scale(this.affine(resolve, 3), t.text === '-' ? -1n : 1n);
    else if (t.text === '(') {
      a = this.affine(resolve);
      this.expect(')');
    } else if (/^\d+$/.test(t.text)) a = constant(BigInt(t.text));
    else if (namePattern.test(t.text)) a = variable(resolve(t));
    else return this.fail(t, 'expected affine integer expression');
    while (precedence(this.peek().text) >= min) {
      const op = this.take();
      if (op.text === '/') this.fail(op, 'division is not an affine integer operator');
      const b = this.affine(resolve, precedence(op.text) + 1);
      if (op.text === '*') {
        if (a.terms.length && b.terms.length) this.fail(op, 'non-affine product');
        a = a.terms.length ? scale(a, BigInt(b.constant)) : scale(b, BigInt(a.constant));
      } else a = add(a, op.text === '-' ? scale(b, -1n) : b);
    }
    return a;
  }
  private type(introduce: boolean) {
    this.expect('f32');
    this.expect('[');
    return this.list(']', () =>
      this.affine(t => {
        if (introduce) this.shapeNames.add(t.text);
        else if (!this.shapeNames.has(t.text)) this.fail(t, `unknown shape name '${t.text}'`);
        return t.text;
      }),
    );
  }
  private scope(names: readonly Token[], parent: Scope, declared?: readonly Affine[]) {
    const scope = new Map(parent),
      own = new Set<string>();
    const pending: PendingBinder[] = names.map((t, i) => {
      if (own.has(t.text)) this.fail(t, `duplicate index '${t.text}'`);
      own.add(t.text);
      const binder = { ...this.node(t), name: t.text, extent: declared?.[i] };
      scope.set(t.text, binder);
      return binder;
    });
    return {
      scope,
      finish: (): Binder[] =>
        pending.map(({ id, at, name, extent }) => {
          if (!extent) throw errorAt(at, `cannot infer extent of index '${name}'`);
          return { id, at, extent };
        }),
    };
  }
  private load(t: Token, scope: Scope): Expr {
    const tensor = this.tensors.get(t.text) ?? this.fail(t, `undefined tensor '${t.text}'`);
    const pure: (Token | undefined)[] = [];
    const access = this.list(']', () => {
      const start = this.pos;
      const a = this.affine(n => scope.get(n.text)?.id ?? this.fail(n, `unbound index '${n.text}'`));
      pure.push(
        this.pos === start + 1 && namePattern.test(this.tokens[start].text) ? this.tokens[start] : undefined,
      );
      return a;
    });
    if (access.length !== tensor.shape.length) this.fail(t, 'incorrect tensor reference rank');
    pure.forEach((n, i) => {
      if (!n) return;
      const binder = scope.get(n.text)!;
      if (binder.extent && !equal(binder.extent, tensor.shape[i]))
        this.fail(n, `inconsistent extent for '${n.text}'`);
      binder.extent = tensor.shape[i];
    });
    return { ...this.node(t), kind: 'load', tensor: tensor.id, access };
  }
  private maxHasBinderList() {
    let i = this.pos;
    const names: string[] = [];
    while (namePattern.test(this.tokens[i].text)) {
      names.push(this.tokens[i++].text);
      if (this.tokens[i].text !== ',') break;
      i++;
    }
    if (!names.length || this.tokens[i].text !== ')') return false;
    const next = this.tokens[i + 1].text;
    if (
      names.length === 2 &&
      names.every(n => this.shapeNames.has(n)) &&
      (next === '-' || !this.startsExpression(next))
    )
      return false;
    return true;
  }
  private startsExpression(text: string) {
    return text === '-' || text === '(' || namePattern.test(text) || literalPattern.test(text);
  }
  private prefix(scope: Scope): Expr {
    const t = this.take();
    if (t.text === '(') {
      const expr = this.expr(scope);
      this.expect(')');
      return expr;
    }
    if (t.text === '-') return { ...this.node(t), kind: 'op', op: 'neg', args: [this.expr(scope, 3)] };
    if (literalPattern.test(t.text)) return { ...this.node(t), kind: 'literal', text: t.text };
    if (!namePattern.test(t.text)) return this.fail(t, 'expected scalar expression');
    if (this.accept('[')) return this.load(t, scope);
    if (this.accept('(')) {
      if (t.text === 'sum' || (t.text === 'max' && this.maxHasBinderList())) {
        const names = this.list(')', () => this.name());
        const nested = this.scope(names, scope);
        const body = this.expr(nested.scope);
        return { ...this.node(t), kind: 'reduce', op: t.text, binders: nested.finish(), body };
      }
      const op = t.text as Operator;
      if (!['max', 'min', 'exp', 'log', 'sqrt', 'tanh'].includes(op))
        this.fail(t, `unknown builtin '${t.text}'`);
      const args = this.list(')', () => this.expr(scope));
      if (args.length !== arity[op]) this.fail(t, `expected ${arity[op]} arguments to '${op}'`);
      return { ...this.node(t), kind: 'op', op, args };
    }
    if (!this.shapeNames.has(t.text)) this.fail(t, `unknown scalar shape name '${t.text}'`);
    return { ...this.node(t), kind: 'shape', name: t.text };
  }
  private expr(scope: Scope, min = 1): Expr {
    let left = this.prefix(scope);
    while (precedence(this.peek().text) >= min) {
      const t = this.take();
      const right = this.expr(scope, precedence(t.text) + 1);
      left = { ...this.node(t), kind: 'op', op: t.text as Operator, args: [left, right] };
    }
    return left;
  }
  private fn(): TensorFunction {
    this.expect('fn');
    const t = this.name(),
      fn = this.node(t);
    this.tensors.clear();
    this.shapeNames.clear();
    this.expect('(');
    const params = this.list(')', () => {
      const p = this.name();
      if (this.tensors.has(p.text)) this.fail(p, `duplicate parameter '${p.text}'`);
      this.expect(':');
      const param = { ...this.node(p), name: p.text, shape: this.type(true) };
      this.tensors.set(p.text, param);
      return param;
    });
    this.expect(':');
    const resultShape = this.type(false);
    this.expect('{');
    const definitions: Definition[] = [];
    while (!this.accept('return')) {
      const def = this.name();
      if (this.tensors.has(def.text)) this.fail(def, `tensor '${def.text}' already assigned`);
      this.expect('[');
      const names = this.list(']', () => this.name());
      const declared = this.accept(':') ? this.type(false) : undefined;
      if (declared && declared.length !== names.length)
        this.fail(def, 'definition type rank differs from its index list');
      this.expect('=');
      const bound = this.scope(names, new Map(), declared);
      const expr = this.expr(bound.scope),
        binders = bound.finish();
      this.expect(';');
      const tensor = { ...this.node(def), name: def.text, shape: binders.map(b => b.extent), expr, binders };
      this.tensors.set(def.text, tensor);
      definitions.push(tensor);
    }
    const r = this.name();
    const result = this.tensors.get(r.text) ?? this.fail(r, `undefined return tensor '${r.text}'`);
    if (!sameShape(result.shape, resultShape)) this.fail(r, 'return shape disagrees with signature');
    this.expect(';');
    this.expect('}');
    return {
      ...fn,
      name: t.text,
      shapeNames: [...this.shapeNames].sort(),
      params,
      resultShape,
      definitions,
      result: result.id,
    };
  }
  parse(): TensorModule {
    const functions = [this.fn()];
    while (this.peek().text !== eof) functions.push(this.fn());
    return { functions };
  }
}

export const parse = (source: string): TensorModule => new Parser(scan(source)).parse();
