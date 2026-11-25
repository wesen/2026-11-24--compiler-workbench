# API reference

Everything below is reachable from `wb`, the workbench root. The console
and the agent's `eval` get the same scope: `wb`, `p` (the current
program), `project` (the open project), `ui` (the live UI), `log`,
`yaml`, and the shortcuts `src` and `book`. A project's workbench
scripts get `wb`, `p`, `project`, `args`, `param`, `log` and `yaml`; its
UI scripts get `ui`, `wb`, `p`, `project` and `param`. Code runs as the
body of a function, so `return` a value to see it; results print as
YAML.

## Root: wb

- `wb.current`: the program open in the workbench, as a Program handle,
  or null
- `wb.program(name, source, { inputs, open })`: run the front end on
  `source` and ingest it as revision r0; `open: true` makes it current
- `wb.open(name)`: make a program current
- `wb.programs()`: every program made this session
- `wb.projects`: projects: see Projects
- `wb.passes()`, `wb.analyses()`, `wb.pipelines()`: what is registered,
  with what each needs, writes and preserves
- `wb.pass(name)`, `wb.analysis(name)`, `wb.pipeline(name)`: builders:
  see Passes, Analyses, Pipelines
- `wb.lattice`: `set()`, `flat()`, `interval()`, `map(inner)`, and
  `TOP`, `BOT`, `MIN`, `MAX`
- `wb.param`: sliders and toggles a script declares: see Parameters
- `wb.fragment(name)`, `wb.use(name)`, `wb.drop(name)`,
  `wb.fragments()`: add members to handles: see Fragments
- `wb.focus(id)`, `wb.focused`: select an entity in every view; returns
  what is related to it
- `wb.view(name)`: open a view: projects, files, editor, scripts,
  source, ir, cfg, lineage, facts, pipeline, timeline, checks, rv32,
  run, console, agent, reference, book, code
- `wb.source`, `wb.book`: the workbench's own source, and the book: see
  Source and book
- `wb.help(topic)`: this reference, one section at a time
- `wb.errors()`: every error code and what it means
- `wb.backendOptions()`: the backend's options and their defaults
- `wb.on(event, fn)`: events: program, revision, check, image, run,
  focus, projects, files, ui, params, view, log
- `wb.log(x)`, `wb.yaml(x)`: print, and format as YAML

## Projects

A project is a set of plain files. The built-in ones ship with the page;
your edits to one are kept in this browser as an overlay that `reset()`
discards, and projects you make are kept whole.

- `project.json`: title, about, group, `sources` (the order the typed
  files compile in), `inputs` (per function, per parameter: see Runs and
  checks), `pipeline`, `scripts` (per script: `{ about, fresh }`), `ui`
  (`{ order, off }`), `chapter`, `focus` (a line), `try` (questions for
  the agent)
- `*.typed`: the source. Every typed file compiles into one program; ids
  and line numbers refer to the files joined in order, and `p.where(id)`
  or `p.locate(line)` gives `file:line`
- `scripts/*.js`: workbench scripts: queries, experiments, passes. The
  body of a function with `wb, p, project, args, param, log, yaml` in
  scope; it returns a value
- `ui/*.js`: UI scripts: the body of a function with `ui, wb, p,
  project, param` in scope; they return tiles (see UI DSL)
- `notes.md`: notes shown under the source

```js
wb.projects.list({ group: 'Bounds' }); // [{ id, title, group, about }]
// its program at r0 is now current; its UI scripts run
const project = wb.projects.open('bounds-lab');
project.files.list(); // [{ path, kind, lines, edited }]
project.files.read('scripts/checks.js');
// a typed file or project.json rebuilds the program at r0
project.files.write('main.typed', text);
// a UI script remounts its tiles
project.files.write('ui/mine.js', body);
project.files.remove('notes.md');
project.files.rename('a.typed', 'b.typed');
project.scripts();
// with their first comment line; UI scripts say on or off
project.uiScripts();
project.run('checks'); // a workbench script on the open program
// on a fresh copy at r0, so it can change it freely
project.run('sweep', { n: 4 }, { fresh: true });
project.fresh(); // a fresh copy of the program, for experiments
project.setUi('bce-marks', false); // turn a UI script's tiles off
project.reset();
// built-in: back to the original · a JSON of every file
project.export();
wb.projects.create('my-loops', {
  title: 'My loops',
  source: 'function f(x: i32): i32 { return x * 8; }',
});
wb.projects.create('kit', {
  files: {
    'project.json': '{ "title": "Kit" }',
    'main.typed': '…',
    'ui/board.js': '…',
  },
});
wb.projects.duplicate('blend', 'my-blend');
wb.projects.import(json);
wb.projects.remove('my-loops');
```

A script marked `fresh` in project.json always runs on a fresh copy. A
write to a .js file is checked for syntax first, and a project.json
write must parse. `wb.projects.current` is the open project; `p.project`
names the project a program came from.

## Programs

A Program handle is what `wb.current`, `wb.program()` and
`project.program` return.

- `p.id`, `p.name`, `p.source`, `p.status`, `p.error`, `p.rev`,
  `p.project`, `p.inputs`: status is 'ok' or 'frontEndError'; error has
  line, col, message, and file and fileLine
- `p.files()`, `p.locate(line)`, `p.where(id)`: the typed files and the
  lines each covers; a line of the program as `{ file, line }`; the
  `file:line` places an entity came from
- `p.fns()`, `p.fn(name)`: function names; a Function handle
- `p.get(id)`, `p.has(id)`: a handle for any id; whether it exists
- `p.describe()`, `p.listing(fn)`: a summary; the statements of every
  block as text
- `p.apply(pass, { fn })`: run one pass (a name or a pass you made) over
  every function, or one; one revision if anything changed. Returns `{
  pass, rev, edits, changed, kinds, ms }`
- `p.dryRun(pass)`: what a pass would change now, without keeping it: `{
  pass, edits, kinds, changes }`, changes listing each edit (fn, kind,
  from, text, because)
- `p.actions()`: every built-in pass that would change something now
- `p.pipeline(x, { checkEach, count, enabled })`: run a pipeline: 'O1',
  'O2', a list of pass names, or a builder; checks against r0 after
  every pass that changes something unless `checkEach: false`
- `p.undo()`, `p.checkout('r2')`: go back; checkout drops later
  revisions
- `p.revisions()`, `p.edits('r3')`, `p.diff('r0', 'r4')`: the timeline
  and its edits
- `p.edit(source)`: a new program from new source, at r0, under the same
  name (for programs made with `wb.program`; a project's program changes
  through its files)
- `p.facts()`, `p.fact(name, fn)`: cached facts with their status; one
  fact computed now
- `p.why(id)`, `p.lineage(id)`, `p.lines(id)`, `p.related(id)`,
  `p.statusOf(id)`, `p.text(id)`: provenance: see Provenance
- `p.cases(fn, opts)`, `p.exec(fn, args, opts)`, `p.check(opts)`: see
  Runs and checks
- `p.compile(opts)`, `p.image()`, `p.images()`, `p.reference()`,
  `p.machine(fn)`: see The backend and images

## Handles and selections

Every entity has a readable id and a handle. Handles are read-only
proxies: reading a member that does not exist throws `unknownMember`
with the nearest name and the list of members; assigning throws
`immutable`. Every handle has `id`, `kind`, `status`, `text`,
`describe()`, `origin()`, `lineage()`, `lines()`, `why()` and
`history()`.

- Function `fn:blend`: name, params, result, blocks(), stmts(),
  values(), ops(), locals(), loops(), fact(name), listing()
- Block `bb:blend.3`: succ, preds(), stmts(), defs(), uses()
- Statement `s:blend.7`: op, local, localName, value, cond, addr, to,
  then, else, width, offset, block, values()
- Value `v:blend.12`: op, imm, args, isConst, isLeaf, isPure, hasEffect,
  isBoolean, reads, statement, parent, same(other), size()
- Op `op:blend#5`: op, operands, line, col, derived (what came from it)
- Instruction `insn:blend+0x1c@r4`: offset, word, text, fn, image,
  covers, why

Statement ops: set, store, eval, br, br_if, return, trap. Value ops:
const, get (a local), add, sub, mul, div, rem, and, or, xor, shl, shr,
shru, eq, ne, lt, gt, le, ge, ltu, geu, eqz, load (32-bit, imm is the
offset), load16u, call (imm is the callee). Other ids: locals
`local:blend/s`, loops `loop:blend@bb:blend.1`, facts
`fact:liveness(blend)@r2`, edits `edit:r3.0`, images `img:blend@r4`.

A selection is lazy: nothing runs until you ask for a result.

```js
const f = p.fn('blend');
f.values().op('mul').count(); // how many multiplications
f.stmts()
  .where(s => s.op === 'set')
  .table('id', 'localName', 'text');
f.ops()
  .line(5)
  .map(o => o.op); // what the front end emitted for line 5
f.blocks().first().stmts().ids();
```

Selection members: where(fn), line(n), op(name), take(n), ids(), list(),
first(), count(), map(fn), sum(fn), table(...columns), result().

## Passes and transactions

A pass declares what it writes and what it preserves, asks for the facts
it needs, and changes the program only through `tx`. Every change
records its origin (what it was made from) and its because list (what
makes it valid).

```js
wb.pass('add-self')
  .about('x + x, for a pure x, becomes x * 2')
  .needs({ live: 'liveness' }) // facts arrive as the third argument
  .writes('values') // values, stmts, locals, cfg
  .preserves('cfg', 'dominators', 'loops', 'liveness', 'reaching')
  .run((fn, tx, facts) => {
    tx.rewrite(v => {
      // bottom-up over every statement's values
      const [a, b] = v.args;
      if (v.op === 'add' && a.isPure && a.same(b))
        return tx.make('mul', v.args[0].id, tx.const(2), {
          because: [v.args[1].id],
          note: 'x + x = x * 2',
        });
    }); // return nothing to keep a value
  });
p.apply('add-self');
```

- `tx.const(n, opts)`, `tx.make(op, ...args, opts)`, `tx.get(local,
  opts)`: new values; opts: imm, from, because, note
- `tx.local(name, opts)`: a new local; returns its index
- `tx.set(local, value, opts)`, `tx.stmt(fields, opts)`: new statements
  (not yet placed)
- `tx.insert(tx.at.before(stmt), sid)`: place a statement:
  at.start(block), at.end(block), at.before(stmt), at.after(stmt)
- `tx.remove(stmt, { because })`: remove a statement; because is
  required
- `tx.move(stmt, position)`, `tx.setField(stmt, field, value)`,
  `tx.replaceStmt(old, fields)`: change statements and branches
- `tx.block(opts)`: a new block
- `tx.rewrite(visit, blocks)`, `tx.replace(old, next)`: rebuild value
  trees
- `tx.note(text)`: an edit that only records a note

Writing a kind of entity a pass did not declare throws `undeclaredWrite`
and rolls the revision back. After a pass, every fact it did not declare
in preserves goes stale. Built-in passes: fold, simplify, constprop,
dce, cfg, licm, lvn, strength, bce, subst, and div-to-shift, which is
wrong on purpose.

Facts a pass can need, by analysis: liveness `{ in, out, liveAfter(sid)
}`, reaching `{ in, out, reachingAt(sid, local) }`, ranges `{ in,
at(sid, local), of(sid, valueId) }`, dominators `{ idom, dominates(a,
b), children }`, loops `[{ id, head, latch, body, preheader, exits,
assigned }]`, cfg `{ succ, preds, rpo }`. Maps are keyed by block id;
locals are indices into `fn.locals()`.

## Analyses and lattices

An analysis is a lattice and a transfer function over blocks, solved by
the same worklist solver the built-ins use.

```js
wb.analysis('assigned')
  .about('locals assigned on some path to each block')
  .forward() // or .backward()
  .lattice(wb.lattice.set()) // bottom ∅, join ∪
  .transfer((block, inn) => new Set([...inn, ...block.defs()]))
  .register();
// Map: block id → Set of local indices
wb.projects.open('my-analysis').program
  .fn('f').fact('assigned').value.in;
```

Lattices: `set()` (finite height), `flat()` (TOP 'varies', BOT
'unknown'), `interval()` (needs widening, provided), `map(inner)`. An
infinite-height lattice without `.widen((old, next) => …)` is refused
with `noWidening`. The solver widens only at loop heads. Facts are
cached per function and revision: `fact.status` is 'fresh' or 'stale'.

## Pipelines

```js
wb.pipelines(); // O0, O1, O2, loops, checks, broken
p.pipeline('O2');
p.pipeline(['cfg', 'fold', 'dce'], { checkEach: false });
const plan = wb.pipeline('mine')
  .pipe('fold')
  .pipe('constprop')
  .repeat('unchanged', b => b.pipe('simplify').pipe('dce'))
  .checkEach(true, { count: 40 })
  .build();
plan.explain(); // the steps, what each needs, writes and preserves
p.pipeline(plan);
```

## Strategies and the compiler

A strategy is data: a v6 Strategy IR plan over the passes. A project
keeps its own as `strategies/<name>.json`, in a short form:

```js
// { "passes": "O2" }                      a pipeline, or pass names
// { "choose": { "O1": "O1", "O2": "O2" }, "by": "instructions",
//   "constraints": [["bytes", "<=", 100]] }   the best candidate
// { "repeat": ["cfg", "fold", "dce"], "max": 8 }   until unchanged
const plan = wb.strategy.choose('fast',
  { O1: 'O1', O2: 'O2', mine: ['add-self', 'fold'] }, 'instructions');
wb.strategy.explain(plan); // the plan as indented lines
const r = wb.strategy.run(p, plan); // or a name, or the JSON
r.decisions[0].winner; // every alternative: metrics, or why rejected
r.published; // the winning chain, one revision per pass
r.trace; // one row per node the interpreter ran
wb.strategy.save('fast', plan); // strategies/fast.json, 72 columns
wb.strategy.list(); // the project's, the presets, the pipelines
```

Metrics (`typed.metrics@1`): instructions (on the emulator, over the
project's cases), bytes, statements, blocks. Every pass in a plan is
gated by the meaning contract: a candidate whose pass is rejected is a
rejected alternative, not a failure.

```js
wb.compiler(); // passes, analyses, pipelines, strategies, user passes:
//   ids, versions, needs, writes, preserves, where each is defined
wb.source.definition('licm'); // a pass's or an analysis's source
```

`wb.pass(name)` makes a framework pass like the built-ins; it cannot
take a built-in name. Define it in a project script, run the script,
then apply it or name it in a strategy candidate.

## Runs and checks

```js
// the evaluator: { result, trap, steps, buffers }
p.exec('blend', [[1, 2, 3, 4], 4, 3, 5]);
// the emulator, on a fresh image
p.exec('blend', [[1, 2, 3, 4], 4, 3, 5], { engine: 'rv32' });
p.check(); // head against r0, every function, 100 cases
p.check({ fn: 'blend', against: 'image', count: 300 });
// against the reference compiler's image (built-in projects, unedited)
p.check({ against: 'reference' });
p.cases('blend', { count: 5, seed: 1 }); // the generated inputs
```

Arguments: a number for i32 and bool; an array of cells for a buffer;
text for a string; `{ x: 1, y: 2 }` for a record; a case name for an
enum. Inputs for generated cases, per parameter: `[lo, hi]`, a number,
`{ buffer: [minLen, maxLen], cell: [lo, hi] }`, `{ cells: [...] }`, `{
string: 'text' }`, `{ record: { x: [lo, hi] } }`, `{ oneOf: [...] }`.

A check compares result, trap and memory. A trap must match a trap. A
case that hits the step limit in either engine is inconclusive, not a
verdict. A result: `{ status, fns: [{ fn, agree, total, bothTrap,
inconclusive, counterexamples }] }`.

## The backend and images

```js
p.pipeline('O2', { checkEach: false }); // on Blend: r1 … r6
const img = p.compile({
  registers: 4,
  fuse: true,
  immediates: true,
  divmagic: true,
  useRanges: true,
});
img.id;
img.bytes;
img.fns.blend; // { bytes, insns, frame, saved, spills, regs, leaf }
// offset, instruction, the statement it covers, the line
img.listing('blend');
img.insns('blend'); // the same as rows, with ids
// on the emulator: steps are instructions
img.run('blend', [[1, 2, 3], 3, 2, 2]);
// instructions executed per source line, and the hottest
img.heat('blend', [[1, 2, 3], 3, 2, 2]);
img.check({ count: 200 });
// the stages: selected code on virtual registers, intervals, spills
p.machine('blend');
p.reference(); // the reference compiler's image size per function
// an image of an earlier revision; the head is left as it is
p.compile({ rev: 'r2' });
// two revisions compiled and compared instruction by instruction
p.asmDiff('r0', 'r6', { fn: 'blend' });
// or two option sets at one revision
p.asmDiff('r6', 'r6', { fn: 'blend', optionsB: { registers: 4 } });
```

Options: `registers` ('all' or a count), `fuse`, `immediates`,
`divmagic`, `useRanges` for instruction selection; `order` ('caller':
try t0–t4 and the a-registers first, or 'callee': s1–s11 first), `spill`
('furthest': spill whichever interval ends last, or 'current': spill the
one that found no register) and `hints` (parameters prefer their
a-register, returned values a0) for register allocation. An asmDiff
result has both sides' bytes, frame, spills and the instructions run on
20 generated cases, and rows `{ op: '=' | '-' | '+', a, b, text, covers
}` with branch targets written as block names, so code that only moved
compares equal.

Instruction selection tiles value trees; the register allocator is a
linear scan with callee-saved registers for values that live across
calls; the encoders, the division magic numbers, the disassembler and
the emulator are reused from the repo's compiler. An image is an entity
of its program and records the revision it was made from; its status is
current, older, or stale.

## Parameters

A script can declare parameters. Each call returns the current value and
adds a control to the Pipeline view; moving it changes the value the
script reads the next time it runs. In a UI script, `ui.param.*`
declares the same kind of parameter as a cell, so tiles that read it
update at once (see UI DSL).

```js
const regs = wb.param.int('registers', {
  min: 1,
  max: 16,
  default: 16,
  about: 'for the allocator',
});
const level = wb.param.choice('pipeline', ['O0', 'O1', 'O2'], {
  default: 'O2',
});
const fuse = wb.param.bool('fuse', { default: true });
wb.param.list();
wb.param.set('registers', 4);
wb.param.reset();
```

## UI DSL

A project's UI scripts build its own tiles. A UI script is the body of a
function with `ui`, `wb`, `p`, `project` and `param` in scope; it
returns one tile or a list. The same `ui` is in the console and the
agent's scope, where `ui.live` changes the screen one call at a time.

```js
// ui/bounds.js: one tile that follows the program
// a cell: the result of scripts/checks.js
const checks = ui.from('checks');
const sel = ui.selection(); // a cell: what is selected in the views
const stay = checks.map(r => r.filter(x => x.bce === 'keeps').length);

// place: splitRight, splitLeft, splitAbove, splitBelow, tabWith,
// replace
return ui.tile('bounds')
  .title(checks.map(rows => `Bounds checks · ${rows.length}`))
  .place({ splitRight: 'ir', size: 0.45 })
  .body(
    ui.col(
      ui.row(
        ui.stat('checks', checks.map(r => r.length)),
        ui.stat('stay', stay).badIf(n => n > 0),
      ),
      ui.table(checks)
        .columns('fn', 'line', 'test', 'bce')
        .highlight(sel, (r, s) => s.id === r.check)
        .onRow((r, { wb }) => wb.focus(r.check)),
      // handlers may change the program; queries may not
      ui.button('apply bce').on(({ p }) => p.apply('bce')),
    ),
  );
```

Cells are values that rerun when what they read changes. Reading `p` or
`wb` in a query makes the program a dependency (every revision, undo or
rebuild); reading `project` makes the files one; reading another cell's
`.value` makes that cell one.

- `ui.query(ctx => value, label)`: computed from `{ p, wb, project }`;
  read-only: a query that changes the program throws
  `sideEffectInQuery`. An async query is pending until it settles
- `ui.from(script, args, { fresh })`: a workbench script's result; args
  may hold cells. `fresh` (or `fresh: true` in project.json) runs it on
  a fresh copy, where it may change the program
- `ui.state(v)`, `cell.set(v)`, `cell.update(fn)`: a value you set;
  computed cells refuse `set` with `readOnlyCell`
- `ui.derive({ a, b }, ({ a, b }) => …)`, `cell.map(fn)`,
  `cell.as(label)`: computed from other cells
- `ui.param.int(name, { min, max, step, default })`, `.float`, `.bool`,
  `.choice(name, options)`, `.set(name, options)`: parameters: cells
  shown as controls here and in the Pipeline view; `choice` options may
  be a cell. `ui.param.value(name, v)` sets one
- `ui.selection()`: `{ id, related: { lines, values, stmts, insns } }`
  for the selected entity
- `cell.value`, `cell.peek()`: read and track; read without tracking

- `ui.text(markdown)`, `ui.code(text, lang)`, `ui.json(x)`: text takes
  Markdown with ids that link
- `ui.stat(label, value)`: `.badIf(fn)`, `.compareTo(cell)` (shows
  before → after), `.unit(text)`
- `ui.badge(text, tone)`: tone: good, warn, accent, dim
- `ui.table(rows)`: `.columns('key', ['label', row => value], …)`,
  `.onRow((row, ctx) => …)`, `.highlight(cell, (row, v) => bool)`,
  `.rowClass(fn)`, `.cellStyle(column, (v, all) => ({ shade }))`,
  `.sort(key)`, `.limit(n)`, `.title(t)`, `.empty(t)`; a cell may hold a
  component
- `ui.list(items)`, `ui.tree(root)`: `.item(fn)`; tree `.label(fn)`,
  `.children(fn)`, made for `p.why(id)`
- `ui.diff(x)`: an asmDiff result, or `{ a, b }` texts compared line by
  line; `.summary(fn)`
- `ui.chart(rows)`: `.line()`, `.bar()`, `.scatter()`, `.x(key)`,
  `.y(key, key2)` (two axes, or `.sameAxis()`), `.tone(row => tone)`
  (good, bad or mut), `.mark(row => 'cross')`, `.onPoint(fn)`,
  `.title(t)`, `.height(px)`
- `ui.slider(param)`, `ui.toggle(cell)`, `ui.select(cell, options)`,
  `ui.multiselect(param)`, `ui.input(cell)`: controls
- `ui.button(label)`: `.on(ctx => …)` (may change the program; one
  batch, one refresh), `.disabledIf(cell)`, `.tone('primary')`
- `ui.row(…)`, `ui.col(…)`, `ui.section(title, …)`, `ui.tabs({ name:
  component })`, `ui.when(cell, v => component).else(component)`: layout

```js
// a task: long work that reports partial results, with Start, Stop
// and a progress bar
const sweep = ui.task(
  async ({ project }, { signal, progress, partial }) => {
    for (let n = 1; n <= 24 && !signal.aborted; n++) {
      const args = { options: { registers: n } };
      const r = project.run('replay', args, { fresh: true });
      partial({ registers: n, ...r });
      progress(n / 24);
      await ui.idle();
    }
  },
);
sweep.restartOn(order); // a change restarts it once it has run
ui.col(
  sweep.controls(),
  ui.chart(sweep.rows).line().x('registers').y('bytes', 'spills'),
);

// annotations: badges and classes on the built-in views, recomputed
// when the cells they read change
ui.annotate('ir')
  .stmt(s => s.op === 'trap' && ui.badge('trap', 'warn'));
ui.annotate('ir')
  .value(v => …)
  .block(b => …);
ui.annotate('source')
  .gutter(line => …)
  .lineClass(line => 'heat2');
ui.annotate('rv32').insn(x => …);
ui.annotate('cfg').block(b => …);

// fragments add members to components
ui.fragment('heat')
  .on('Table')
  .method('heat', (t, col) =>
    t.cellStyle(col, (v, all) => ({ shade: v / Math.max(...all) })),
  );
ui.use('heat');

// ui.component defines new ones; data is a read-only query of the props
ui.component('intervals')
  .props({ fn: 'string', options: 'object' })
  .data(({ p }, { fn, options }) => p.machine(fn, options))
  .render((m, h) => h.svg({ viewBox: '0 0 400 100' }, …))
  .register();
ui.intervals({ fn, options }); // props may be cells

// a plan: the tiles and the cells, with what each reads, unmounted
ui.plan('bounds').explain();

// the live UI: tiles changed one call at a time
const t = ui.live.tile('quick', {
  title: 'Quick look',
  place: { splitRight: 'ir' },
});
t.append(ui.table(ui.query(({ p }) => p.fns())));
// a handle also has replace, clear, set('title', t), focus and remove
ui.live.tiles();
ui.live.close('quick');

// in the console or eval, a returned tile is mounted as a live tile
return ui.tile('mine').body(ui.text('hello'));
```

Builders are proxies: a misspelt member throws `unknownMember` with the
nearest name, a Selection or a Promise where a cell belongs throws
`notACell`, an object where a component belongs `notAComponent`, two
cells that read each other `cycle`. A UI script's error is shown in the
Scripts view and its other tiles stay up. Tiles are named
`u-<script>-<id>` in the dock; `place` names a built-in view or another
tile by its id. In project.json, `ui.order` lists scripts that must run
first (one that registers a component or a fragment) and `ui.off` the
ones that start off.

## Fragments

A fragment adds attributes and methods to a kind of handle, without
changing the engine.

```js
wb.fragment('cost')
  .on('Value')
  .attr('cost', v => ({ mul: 3, div: 34 })[v.op] ?? 1)
  .on('Function')
  .method('cost', f => f.values().sum(v => v.cost));
wb.use('cost');
p.fn('blend').cost();
```

Kinds: Value, Statement, Block, Function, Op, Instruction. Asking for a
member a fragment provides before `wb.use` names the fragment in the
error. Two fragments in use that define the same member are refused with
`fragmentConflict`.

## Provenance

Every entity records where it came from. `origin` names what it was made
from and by which pass at which revision; `because` names the facts or
entities that make it valid.

```js
// the because-chain as a tree:
// { id, text, status, via, rev, note, from, because }
p.why('s:blend.15');
p.lineage('v:blend.37'); // down to front-end ops
p.lines('insn:blend+0x8@r6');
// { lines, values, stmts, insns } derived from it
p.related('op:blend#35');
p.statusOf('s:blend.0'); // live, removed@r5, replaced@r4, detached
```

## Source and book

The workbench's own source is in the page and readable through
`wb.source` (`src` in the agent's scope).

```js
src.files(); // [{ path, lines, bytes, about }]
// functions, passes and sections with line numbers
src.outline('app/engine/passes.js');
src.read('app/engine/passes.js', 180, 230);
src.grep('undeclaredWrite'); // [{ file, line, text }]
src.find('applyPass'); // where a name is defined
book.contents();
book.read('passes', 'Transactions');
book.search('widening');
book.open('loops');
```

## Errors

Refusals throw a WorkbenchError: `[code] message` and a `fix:` line. A
pass that throws leaves its program as it was. Codes: unknownMember,
immutable, absent, unknownFunction, unknownPass, unknownAnalysis,
unknownPipeline, unknownProject, unknownScript, unknownFile,
scriptSyntax, badPath, badJson, useProjectFiles, undeclaredWrite,
missingBecause, noWidening, noFixpoint, frontEndError, readOnly,
badProject, builtinProject, duplicateProject, notBuiltin, unsupported,
noReference, fragmentConflict, unknownOption. The UI DSL adds notACell,
notAComponent, notATile, notAParam, sideEffectInQuery, cycle,
readOnlyCell, paramConflict, badPlacement, badProps, unknownFragment,
unknownTile, noProject. `wb.errors()` explains each.
