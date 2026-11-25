---
id: language
title: The typed language and its front end
part: Part I · The workbench
projects: match-enum, strings, records, distinct
---
# The typed language and its front end

The programs are a typed subset of JavaScript from the repo's compiler.
The workbench does not parse them itself: `compiler/typed-wasm.js`
parses, type-checks and emits stack code, and reports every operation it
emits with the source span of the token that caused it. Those spans are
where provenance starts.

## 1. What the language has

Functions over `i32`, `bool`, `string`, `buffer`, records, enums and
distinct types. Statements: `const`, `let`, assignment, `if`/`else`,
`for`, `while`, `break`, `return` and `match`. Expressions: `+ - * / %`,
`>>`, comparisons with `===` and `!==`, `&&`, `||`, `!`, `Math.min`,
`Math.max`, `.length`, `.charCodeAt(i)` and `.setCharCodeAt(i, v)`.

What it does not have matters as much. Probing the front end while
writing the projects found these refusals:

| written | front end says |
|---|---|
| `x << 2`, `x & y`, bitwise or and xor | not in the language: `>>` is the only bitwise operator |
| `x > 0 ? x : 0` | invalid token |
| `s += x`, `i++` | expected = |
| `continue` | unknown local continue |
| a function calling itself | recursive call cycle |
| `if (c) y = 1;` | an unbraced if body must be a return |

No recursion means the call graph is acyclic and stack depth is bounded,
which the backend relies on.

## 2. Buffers, strings and records in memory

A `buffer` is a pointer to a 32-bit length followed by 16-bit cells.
`work.charCodeAt(i)` is not one load: the front end emits a bounds check
first, as in this excerpt from line 5 of Blend, in its own words:

```text
local.get 0 · i32.load 2,0 · i32.ge_u · if 64 · unreachable · end
local.get 0 · local.get 7 · i32.const 1 · i32.shl · i32.add · i32.load16_u 1,4
```

Load the length, compare it unsigned with the index (so a negative index
also fails), trap if out of range, then load the cell at `work + 4 + 2 *
i`. A `string` is the same layout. A record is a pointer to one 32-bit
word per field: in [Records](project:records), `p.x` is a load at offset
0 and `p.y` at offset 4, and assigning `p.x` is a store.

## 3. Enums, match and distinct types

An enum is an `i32` with names. In [Enums and
match](project:match-enum), `Square = 4` makes the case compare against
4, and `Tri` follows at 5. `match` becomes one compare and branch per
arm:

```js
const p = wb.projects.open('match-enum').program;
return [6, 7, 8].map(
  n =>
    n +
    ': ' +
    p.fn('area')
      .ops()
      .line(n)
      .map(o => o.op)
      .join(' '),
);
```

`type Cm = distinct i32` keeps centimetres apart from plain numbers in
the type checker and costs nothing after it: in [Distinct
types](project:distinct) the store sees `i32`, and nothing in the image
tells a centimetre from an integer.

## 4. Front-end errors are results

A program that does not pass the front end is still a program: its
status is `frontEndError`, with a line, a column and a message. The
Source view marks the line, and every other view says what is wrong
instead of failing.

```js
const bad = wb.program('oops', 'function f(x: i32): i32 { return y; }');
return { status: bad.status, error: bad.error };
```

> **Try it.** In the Source view, delete a closing brace. The gutter
> marks the line within half a second, and the IR view shows the
> message. Put the brace back and the program is ingested again at r0.

Next: what the workbench does with the stack code once the front end has
accepted it, in [The store](chapter:store).
