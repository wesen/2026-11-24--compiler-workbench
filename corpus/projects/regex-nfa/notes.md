# Thompson regex matcher

`regexMatch(pattern, text)` compiles the pattern on every call and
returns `1` for a full match or `0` otherwise. It leaves both buffers
unchanged. A pattern contains up to four concatenated literals or
inclusive ranges such as `[a-c]`. Each piece may have a trailing `*`.
Range endpoints are ordered and may be equal. Patterns and texts may be
empty. Letters come from `a` through `d`, and texts have at most
eight characters.

## Follow `a*b` over `aaab`

The parser emits four rows. State 0 splits to state 1 (consume `a` and
return to 0) and state 2 (consume `b` and go to 3). State 3 accepts.
From the initial mark at state 0, the epsilon closure marks states
1 and 2.

| Text consumed | Marks after closure |
| --- | --- |
| empty | 0, 1, 2 |
| `a` | 0, 1, 2 |
| `aa` | 0, 1, 2 |
| `aaa` | 0, 1, 2 |
| `aaab` | 3 |

Each `a` returns to state 0, so the closure again permits either another
`a` or the final `b`. The final closure leaves state 3 marked and the
matcher returns `1`.

## Explore `speed`

Run **explore** from the Scripts view to compare two RV32 images on
`[a-c]*[b-d]*a*d` over `abccabbd`. The script starts from a fresh copy
and applies the checked `speed` pipeline there. Inspect the highlighted
`inRange` call in the Range branch first. Inlining moves its two
comparisons into the text loop.

The benchmark includes pattern compilation. All three images returned
`1` with the following instruction counts.

| Image | RV32 instructions |
| --- | ---: |
| Workbench r0 | 8,183 |
| Workbench `speed` | 6,515 |
| Reference compiler | 6,628 |

With `[a-d]*[a-d]*[a-d]*[a-d]*` over `aaaaaaaa`, all nine states are
active after closure. The evaluator executed 5,290 statements at r0 and
4,175 after `speed`. The pass-check budget is 20,000 statements
per case.
