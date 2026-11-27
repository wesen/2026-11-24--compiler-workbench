#!/usr/bin/env python3
"""Compare the Claude judge with the Codex judge on the stage-1 and stage-2 design packs (IRWB-019 step 32).

Reads results/judge-scores-t{1,2}.json (Claude judge), results/judge-scores-t{1,2}-codex.json (Codex judge, Sol high),
the blind keys and the config keys. Prints per-model means of over-engineering and fitness under each judge, the means
by author family, the per-harness means, and the Spearman rank correlation of each score between the two judges.
Usage: 31-compare-judges.py
"""
import json
import os
import re
import statistics as st

RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'various', 'results')
read = lambda f: json.load(open(os.path.join(RES, f)))
MODEL = lambda m: next(n for k, n in [('sol', 'Sol'), ('astra', 'Astra'), ('opus', 'Opus'), ('fable', 'Fable')] if k in m)
HARN = {'codex': 'Codex', 'pi': 'Pi', 'claude-code-subagent': 'Claude'}
family = lambda m: 'Claude' if m in ('Opus', 'Fable') else 'OpenAI'


def rank(xs):
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    r = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        for k in range(i, j + 1):
            r[order[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(a, b):
    ra, rb = rank(a), rank(b)
    ma, mb = st.mean(ra), st.mean(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = sum((x - ma) ** 2 for x in ra) ** 0.5
    vb = sum((y - mb) ** 2 for y in rb) ** 0.5
    return cov / (va * vb) if va and vb else float('nan')


for t in ['t1', 't2']:
    key = read(f'{t}-config-key.json')
    blind = {b['name']: b['item'] for b in read(f'blind-key-{t}.json')}
    claude = {d['doc']: d for d in read(f'judge-scores-{t}.json')}
    codex = {d['doc']: d for d in read(f'judge-scores-{t}-codex.json')}
    rows = []
    for doc in sorted(claude):
        c = key[blind[doc]]
        a, b = claude[doc], codex[doc]
        rows.append(dict(model=MODEL(c['model']), harness=HARN[c['harness']], effort=c['effort'],
                         oe=(a['over_engineering'], b['over_engineering']), fit=(a['fitness'], b['fitness'])))
    print(f'===== {t}: {len(rows)} designs; over-engineering and fitness, Claude judge / Codex judge')
    for m in sorted({r['model'] for r in rows}):
        v = [r for r in rows if r['model'] == m]
        print(f"  {m:6} n={len(v):2}  OE {st.mean(x['oe'][0] for x in v):.2f} / {st.mean(x['oe'][1] for x in v):.2f}"
              f"   fitness {st.mean(x['fit'][0] for x in v):.2f} / {st.mean(x['fit'][1] for x in v):.2f}")
    for f in ['OpenAI', 'Claude']:
        v = [r for r in rows if family(r['model']) == f]
        if v:
            print(f"  {f} designs: fitness {st.mean(x['fit'][0] for x in v):.2f} / {st.mean(x['fit'][1] for x in v):.2f};"
                  f" OE {st.mean(x['oe'][0] for x in v):.2f} / {st.mean(x['oe'][1] for x in v):.2f}")
    for h in ['Codex', 'Pi']:
        for m in ['Sol', 'Astra']:
            v = [r for r in rows if r['model'] == m and r['harness'] == h]
            if v:
                print(f"  {m} {h}: OE {st.mean(x['oe'][0] for x in v):.2f} / {st.mean(x['oe'][1] for x in v):.2f};"
                      f" fitness {st.mean(x['fit'][0] for x in v):.2f} / {st.mean(x['fit'][1] for x in v):.2f}")
    for name, k in [('fitness', 'fit'), ('over-engineering', 'oe')]:
        print(f"  Spearman {name}: {spearman([r[k][0] for r in rows], [r[k][1] for r in rows]):.2f}")
