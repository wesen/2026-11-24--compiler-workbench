---
id: agent
title: The agent, and the workbench's own source
part: Part IV · Projects and the agent
projects: blend
---
# The agent, and the workbench's own source

The agent panel talks to Claude through the page's `sample` capability. It has exactly one tool, `eval`, and that tool is the console: the code it sends runs as the body of an async function with `wb`, `p`, `project`, `projects`, `ui`, `src`, `book`, `log` and `yaml` in scope, and whatever it returns comes back as YAML. Everything the agent does, you can do, and you can see it do it.

## 1. One tool

A tool per operation (apply a pass, run a check, read a file) would be a second API to keep in step with the first, and a narrower one. With one tool the agent composes the API the way you would:

```js
const p = wb.projects.open('blend').program;
const before = p.compile().bytes;
const steps = p.pipeline('O2')
  .steps.filter(s => s.edits)
  .map(s => s.pass);
return { before, after: p.compile().bytes, steps, check: p.check().status };
```

The agent's first message carries its instructions and this workbench's API reference; every message carries a short context block (the open project, its files and UI scripts with any errors, the revision, the selected function and entity, and the mode). Earlier tool calls are summarized as their first line and the start of their result, so long threads stay small. Results are cut at 9,000 characters with a note saying so, and the agent is told to return less rather than more.

## 2. Modes, and taking things back

- **Auto** runs each call as it comes.
- **Ask** shows each call and waits for Run or Skip. A skipped call returns a note telling the agent not to retry it.
- **Read-only** runs calls with the workbench in read-only mode: `p.apply`, `p.pipeline`, `p.undo`, `wb.pass`, `project.files.write` and `wb.projects.create` throw `readOnly` (scripts on fresh copies still run), and the agent is told to say what it would have done.

Before each call the panel takes a snapshot of every program (its revisions, which are immutable, so this is cheap), the current program, every project's files and the live tiles. Every step has **Revert to before this step**, which restores that snapshot and marks the step and every later one as reverted. Passes, analyses and fragments the agent defined stay defined: they change what can be done, not the programs.

## 3. Changing projects, and building tiles

A project is files, so the agent changes it the way you would, file by file. Here it makes a project with a UI script, then opens it:

```js
// each file is plain text; lines joined here so they read as they will
const lines = (...l) => l.join('\n') + '\n';
wb.projects.create('two-checks', {
  files: {
    'project.json': JSON.stringify({
      title: 'Two checks, both removable',
      group: 'Mine',
      inputs: { f: { a: { buffer: [0, 20] } } },
    }),
    'main.typed': lines(
      'function f(a: buffer): i32 {',
      '    let s = 0;',
      '    for (let i = 0; i < a.length; i = i + 1) {',
      '        s = s + a.charCodeAt(i) * a.charCodeAt(i);',
      '    }',
      '    return s;',
      '}',
    ),
    'ui/traps.js': lines(
      'const traps = ui.query(({ p }) =>',
      "  p.fn('f').stmts().where(s => s.op === 'trap').count());",
      "return ui.tile('traps').title('Traps')",
      "  .place({ splitRight: 'ir' })",
      '  .body(ui.row(',
      "    ui.stat('traps', traps).badIf(n => n > 0),",
      "    ui.button('O2').on(({ p }) => p.pipeline('O2')),",
      '  ));',
    ),
  },
});
return wb.projects.open('two-checks').describe();
```

`create` runs the front end first and refuses a source that does not compile, with the file, line and column, and a script with a syntax error, so the agent finds out at once. Projects you or the agent make are kept in this browser and listed under their group in the Projects view; edits to a built-in one are kept as an overlay that **reset** discards.

For an answer that needs a picture once, rather than a tile to keep, the agent uses the live UI: `ui.live.tile('id', { title, place })` returns a handle whose `append`, `replace` and `clear` take the same components a UI script uses, built on cells that follow the program. [Projects and the UI DSL](chapter:projects) describes both.

## 4. Reading its own source

The page embeds every file it is made of, and `wb.source` reads them. That is what lets you ask the agent how something works and get an answer from the code that is actually running:

```js
return {
  files: src.files().map(f => f.path + ' · ' + f.lines + ' lines'),
  passes: src.outline('app/engine/passes.js')
    .split('\n')
    .filter(l => /pass |class |§/.test(l)),
  where: src.find('applyPass'),
};
```

| file | what is in it |
|---|---|
| `app/engine/base.js` | errors, did-you-mean, the guard proxy, YAML |
| `app/engine/store.js` | the front end call, lifting, revisions, printing, lineage and why |
| `app/engine/evaluator.js` | memory images, cases, the evaluator, checks |
| `app/engine/analyses.js` | lattices, the solver, the built-in analyses, the fact cache, the analysis builder |
| `app/engine/passes.js` | transactions, the pass builder, the pass manager, pipelines, the built-in passes |
| `app/engine/handles.js` | handles, selections, fragments, related |
| `app/engine/backend.js` | tiles, intervals, linear scan, frames, encoding, images, runs |
| `app/engine/projects.js` | projects: files, the overlay kept in this browser, building one program from many typed files, running scripts |
| `app/engine/api.js` | the `wb` root, program and image handles, parameters, book and source |
| `app/ui/dsl.js` | the UI DSL: cells and their dependency tracking, components, tiles, annotations, fragments, tasks, plans, the live UI |
| `app/ui/*.js` | the shell, the dock, the views, the agent panel, the Markdown renderer |
| `vendor/typed-wasm.js`, `vendor/rv32-interp.js` | the reused front end and emulator, unchanged |
| `src/reference.md`, `src/book/*.md` | this book and the reference, as written (the projects' files are read through `wb.projects`) |

The engine is about 2,950 lines and the UI DSL about 790; the reused front end alone is 1,667. Files load as plain scripts in that order, each adding to one namespace, so the same files run in this page and in Node, where the projects were checked and the reference images built.

> **Try it.** Ask the agent: "How does a pass that throws leave the program unchanged? Show me the lines." Then ask it to prove the answer by writing a pass that throws halfway and checking the revision count before and after.

## 5. What to build next

Every exercise in this book is a pass, an analysis, a fragment, a backend option or a tile, which means every one can be written in the console or by the agent and checked the same way the built-ins are: copy propagation, a guarded licm for divisions, a bce over value trees, refinement on `!==`, move coalescing, loop layout. The workbench's promise is narrow and it keeps it: whatever you write, you will see what it changed, why it says that was valid, and whether the program still means what it meant.
