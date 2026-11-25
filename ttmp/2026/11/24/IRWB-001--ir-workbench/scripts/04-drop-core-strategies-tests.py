#!/usr/bin/env python3
"""Remove the v6 tests that exercise core/strategies.ts (selectByMetrics, repeatUntilStable),
which IRWB-001 cuts in favour of Strategy IR's chooseBest and repeatUntilStable operators.

A test block starts at a line beginning with "test(" and ends before the next such line or at EOF.
Removes exactly the blocks named below; asserts each is found once and that no reference remains.
Usage: python3 -I 04-drop-core-strategies-tests.py <repo-root> [--dry-run]
"""
import re, sys
root, dry = sys.argv[1], '--dry-run' in sys.argv
targets = {
    'tests/framework/core.test.mjs': [
        'generic selection retains feasibility reasons and deterministic tie-breaking',
        'fixpoint convergence and oscillation have explicit outcomes',
    ],
    'tests/framework/core-review.test.mjs': [
        'fixpoint detection includes IR kind and schema, not only the JSON payload',
        'selection tie-breaking uses portable code-unit order rather than host locale',
    ],
}
for rel, names in targets.items():
    path = f'{root}/{rel}'
    lines = open(path).read().split('\n')
    starts = [i for i, l in enumerate(lines) if l.startswith('test(')] + [len(lines)]
    drop = set()
    for name in names:
        hits = [i for i in starts[:-1] if lines[i].startswith(f"test('{name}'")]
        assert len(hits) == 1, (rel, name, hits)
        s = hits[0]; e = starts[starts.index(s) + 1]
        drop.update(range(s, e))
        print(f'{rel}: drop lines {s + 1}-{e} ({name})')
    kept = [l for i, l in enumerate(lines) if i not in drop]
    text = '\n'.join(kept)
    text = re.sub(r',\s*repeatUntilStable|,\s*selectByMetrics', '', text)
    assert 'repeatUntilStable' not in text and 'selectByMetrics' not in text, rel
    if not dry:
        open(path, 'w').write(text)
