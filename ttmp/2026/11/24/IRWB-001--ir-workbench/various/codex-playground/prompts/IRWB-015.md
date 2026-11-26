## Your program — ticket IRWB-015: a regex matcher
A Thompson-NFA matcher with explicit state sets in Typed: the pattern is compiled to an NFA in `Int32Array`s and matched over a text buffer.
- Why: a second specialization target — a matcher specialized on a fixed pattern should collapse into a hard-coded state machine, as generated lexers such as re2c do; it exercises jump threading, loop unswitching and character-class tests.
- Oracle: JavaScript's `RegExp` on the same pattern and input, restricted to the implemented subset.
