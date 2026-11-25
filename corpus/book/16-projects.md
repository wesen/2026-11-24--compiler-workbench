---
id: projects
title: Projects, and the tiles they build
part: Part IV · Projects and the agent
projects: start-here, bounds-lab, regalloc-lab, heat-lab, orders, ui-gallery
---
# Projects, and the tiles they build

Everything so far has been one program at a time, driven from the
console. A **project** keeps what you learn about a program next to it:
the sources, the queries you ran to understand them, and small tools
that show the answers without being asked. It is a folder of plain
files, and the workbench treats each kind of file differently.

| file | what the workbench does with it |
|---|---|
| `project.json` | reads the title, the order of the sources, the inputs for generated cases, the pipeline, per-script options and the questions for the agent |
| `*.typed` | compiles them together, in the order project.json gives, into one program at r0 |
| `scripts/*.js` | lists them in the Scripts view; each runs as the body of a function with `wb, p, project, args, param, log, yaml` |
| `ui/*.js` | runs them when the project opens; each returns tiles, which go into the dock beside the built-in views |
| `notes.md` | shows it under the source |

The built-in projects ship inside the page. Your edits to one are kept
in this browser as an overlay over the original, so **reset** in the
Files view brings the original back; projects you make are kept whole,
and **Export** writes one as JSON.

## 1. Many files, one program

[Start here](project:start-here) splits its source into `helpers.typed`
and `kernels.typed`. They compile as one program, because the language
has no modules and the front end wants one text. Ids and line numbers
refer to that joined text, and the program keeps a map back to the
files:

```js
const project = wb.projects.open('start-here');
const p = project.program;
return {
  files: p.files(),
  where: p.where('s:peak.3'),
  line12: p.locate(12),
};
```

The Source view shows one file at a time, numbered from 1; selections
and annotations use the joined numbers underneath, so a mark lands on
the right line of the right file. A front-end error names the file and
the line in it. Writing a typed file, or project.json, rebuilds the
program at r0, because a revision of the old source says nothing about
the new one.

## 2. Workbench scripts: queries and experiments

A workbench script is what you would type in the console, kept. Some
only read, like Start here's `shape`, which counts statements, loops,
multiplies and traps per function. Others change the program to find
something out, like `o2-report`, which runs O2 and compiles before and
after. A script that changes the program should run on a **fresh copy**
at r0, so that running it does not disturb what you are looking at; `{
fresh: true }` in project.json makes that the default for it.

```js
const project = wb.projects.open('start-here');
const shape = project.run('shape');
const report = project.run('o2-report', { level: 'O1' }, { fresh: true });
return {
  shape: shape.map(r => `${r.fn}: ${r.stmts} statements, ${r.traps} traps`),
  report: report.bytes,
  still: wb.current.rev,
};
```

`still` is r0: the report's pipeline ran on its own copy.

## 3. UI scripts: tiles from cells

A UI script builds tiles out of components, and components out of
**cells**. A cell is a value that knows what it read. `ui.query(({ p })
=> …)` reads the program, so it runs again after every revision, undo or
rebuild; `ui.from('shape')` is a workbench script's result as a cell;
`ui.state(v)` is a value you set; `ui.derive` and `cell.map` compute
from other cells; `ui.param.int(…)` is a parameter, drawn as a slider
here and in the Pipeline view. Components take cells wherever they take
values, and redraw when a cell they read changes. This is the whole of
Start here's status board:

```js
const rev = ui.query(({ p }) => p.rev, 'rev');
const count = q => q.fns().reduce((n, f) => n + q.fn(f).stmts().count(), 0);
const stmts = ui.query(({ p }) => count(p), 'stmts');
const shape = ui.from('shape');
// reads the files only
const r0 = ui.query(({ project }) => count(project.fresh()), 'stmts at r0');
return ui.tile('status')
  .title(rev.map(r => `Status · ${r}`))
  .place({ splitRight: 'source', size: 0.5 })
  .body(
    ui.col(
      ui.row(
        ui.stat('revision', rev),
        ui.stat('statements', stmts).compareTo(r0),
        ui.stat(
          'traps',
          shape.map(rows => rows.reduce((n, r) => n + r.traps, 0)),
        ).badIf(n => n > 0),
      ),
      ui.table(shape)
        .columns('fn', 'stmts', 'blocks', 'loops', 'muls', 'calls', 'traps')
        .onRow((row, { wb }) => wb.focus(`fn:${row.fn}`)),
    ),
  );
```

Run in the console, the block mounts the tile as a live tile (section
8), since a tile returned there goes on screen. In the project, the
script itself runs once, when the project opens or the file changes. It
is build time: its lambdas that shape the tree (which columns, which
tiles, where they go) run then and never again. The lambdas inside
cells, renderers and handlers are runtime: they run whenever what they
read changes, or when you click. So the cells form a graph, from the
program and the files at the bottom to the tiles at the top, and a
change flows up it. `ui.plan` shows that graph without mounting
anything, with what each cell read and any error it raised:

```js
wb.projects.open('start-here');
return ui.plan('status').explain();
```

## 4. Reading may not write

A query runs whenever the program changes, possibly many times, in an
order you do not choose. If it could change the program it would change
what it reads. So queries run with the workbench read-only, and one that
tries throws `sideEffectInQuery`, naming what it tried and the two
places where a change is allowed: a **handler** (`ui.button('apply
bce').on(({ p }) => p.apply('bce'))`, run once per click, as one batch
with one refresh), and a **fresh copy** (`ui.from('sweep', args, {
fresh: true })`). The same rule is what makes `ui.from` safe: a script
read from the UI either only reads, or runs on its own copy.

Long work goes in a **task**. `ui.task(async (ctx, { signal, progress,
partial }) => …)` gives cells of rows, progress and status and a
component with Start, Stop and a progress bar; `partial(row)` adds a row
as soon as it is ready, and `restartOn(cell)` starts it again when an
input moves. [Register lab](project:regalloc-lab) sweeps the register
count from 1 to 24 that way, replaying the open program's passes on
fresh copies through `scripts/replay.js`; [Pass orders](project:orders)
tries every order of the passes you pick, up to 120 of them, and checks
each.

## 5. Decorating the built-in views

A tile is one place to show an answer. Often the answer belongs where
the thing is: on the statement, on the source line, on the instruction.
`ui.annotate(view)` adds badges and classes to the IR (`stmt`, `value`,
`block`), Source (`gutter`, `lineClass`), RV32 (`insn`) and CFG
(`block`). An annotation is a lambda from the row to a badge, and the
view redraws when a cell it read changes. [Bounds
lab](project:bounds-lab) marks each bounds check with what bce would do
to it, from a script that runs bce as a dry run
(`p.dryRun('bce').changes`); [Heat lab](project:heat-lab) shades source
lines by the instructions they executed and marks the hottest
instructions.

## 6. Extending the DSL

Two ways, the same two the engine has. A **fragment** adds members to
existing components: Heat lab's `ui/fragments.js` gives Table a
`heat(column)` method that shades a column by its share of the largest
value, and Stat a `share(of)`. Fragments must be turned on with
`ui.use`, and two that define the same member are refused, as with
handle fragments. A **component** is new:
`ui.component('intervals').props({ fn: 'string', options: 'object'
}).data(…).render(…).register()` makes `ui.intervals({ fn, options })`,
whose data is a read-only query of its props, which may be cells.
Register lab draws the allocator's live intervals with it.
project.json's `ui.order` runs the scripts that register these first.

## 7. When it goes wrong

Builders are proxies, so a mistake is caught where it is made and says
what to do. A misspelt member gives the nearest name and the list; a
Selection where a cell belongs says it would never update and shows the
`ui.query` that would; an object in a row says to show part of it with
`ui.stat` or all of it with `ui.json`; two cells that read each other
name the loop. An error in one UI script is shown in the Scripts view
and in its Editor, and the project's other tiles stay up. [UI
gallery](project:ui-gallery) makes twelve such mistakes on purpose and
shows each error beside the code that raised it.

## 8. The live UI

A UI script is declarative: it describes tiles, and the workbench keeps
them current. The agent usually wants something else: to show one answer
now, next to the conversation, and add to it as it learns more.
`ui.live` is that: direct mutation instead of a graph to rebuild.
`ui.live.tile(id, { title, place })` returns a handle with `append`,
`replace`, `clear`, `set('title', …)`, `focus` and `remove`. The
components are the same, so a live tile built on queries still follows
the program.

```js
wb.projects.open('bounds-lab');
const t = ui.live.tile('fns', {
  title: 'Functions',
  place: { splitRight: 'ir' },
});
t.replace(
  ui.table(
    ui.query(({ p }) =>
      p.fns().map(f => ({
        fn: f,
        stmts: p.fn(f).stmts().count(),
        traps: p.fn(f)
          .stmts()
          .where(s => s.op === 'trap')
          .count(),
      })),
    ),
  ),
);
t.append(
  ui.text('From the live UI. Apply bce and the traps column follows.'),
);
return {
  tile: t.describe(),
  onScreen: ui.live
    .tiles()
    .filter(x => x.custom)
    .map(x => x.title),
};
```

Live tiles are part of the agent's snapshots, so **Revert to before this
step** takes them away with everything else.

## 9. How it is built

`app/ui/dsl.js` is about 790 lines. A cell records the cells it reads in
a dependency set: reading `cell.value` while another cell is computing
adds an edge. Setting a cell marks everything above it dirty and
schedules the renderers and watchers that read it; they run once,
together, in a microtask, so ten cells changing at once redraw a tile
once. The program, the selection and the files are three source cells
that the workbench's events bump. Each UI script owns its cells,
renderers, tiles and annotations, so running it again, or turning it
off, takes down exactly what it made. Components are proxies over a
props object, with fluent methods that set props and a render function
that runs inside a renderer.

> **Exercise.** Add a UI script to Start here that charts statements per
> function across the revisions: a query over `p.revisions()` that
> compiles nothing, and a line chart with one series per function. Then
> make it a component, so another project can use it.
