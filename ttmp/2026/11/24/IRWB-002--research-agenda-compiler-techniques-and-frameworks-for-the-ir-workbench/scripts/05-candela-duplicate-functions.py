#!/usr/bin/env python3
"""Count Candela functions whose source bodies are identical, as a first estimate for
identical-code folding (agenda item H4).

Reads corpus/candela-gallery/*.typed (text only; nothing is executed). A function is the text
from a line starting with `function NAME(` to the next line that is exactly `}`. Two functions
are "identical" when their parameter lists and bodies are equal character for character; in a
second count, the scene prefix `s<k>_` of called functions is first normalized to `s_`, which
finds functions that differ only in which scene's helpers they call.

Usage: python3 05-candela-duplicate-functions.py [dir]   (default corpus/candela-gallery)
"""
import hashlib
import re
import sys
from collections import defaultdict
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "corpus/candela-gallery")
head = re.compile(r"^(?:export\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(")
functions = []  # (name, text after the name)
for path in sorted(root.glob("*.typed")):
    name, lines = None, []
    for line in path.read_text().splitlines():
        m = head.match(line)
        if m and name is None:
            name, lines = m.group(1), [line[m.end(1):]]
        elif name is not None:
            lines.append(line)
            if line == "}":
                functions.append((name, "\n".join(lines)))
                name = None


def groups(normalize):
    by = defaultdict(list)
    for name, text in functions:
        by[hashlib.sha256(normalize(text).encode()).hexdigest()].append(name)
    return [g for g in by.values() if len(g) > 1]


def report(label, gs):
    dup = sum(len(g) - 1 for g in gs)
    print(f"{label}: {len(gs)} groups, {dup} functions removable of {len(functions)}")
    for g in sorted(gs, key=len, reverse=True)[:8]:
        print(f"    {len(g):3d} x  {', '.join(g[:6])}{' ...' if len(g) > 6 else ''}")


print(f"functions found: {len(functions)}")
print(f"scene sections (s<k>_...): {sum(1 for n, _ in functions if re.match(r's[0-9]+_', n))}")
report("identical text", groups(lambda t: t))
report("identical modulo scene prefix", groups(lambda t: re.sub(r"\bs[0-9]+_", "s_", t)))
