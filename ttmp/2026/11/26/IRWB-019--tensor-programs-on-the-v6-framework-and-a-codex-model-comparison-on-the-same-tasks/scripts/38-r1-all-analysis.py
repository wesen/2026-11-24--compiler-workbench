#!/usr/bin/env python3
"""R1 with the R1b cells (19 designs): map each judge's scores through the blind key, then print per-cell and per-model
scores for every judge present, and the agreement between judges.

Judges: results/r1-all-judges/codex-sol.md (the Codex judge's final message), and the Claude judge's JSON (copied to
results/r1-all-judges/claude-opus.json from the pack directory). Writes results/r1-all-scores.json (one row per judge and
document). Usage: 38-r1-all-analysis.py
"""
import json
import os
import re
import statistics as st

T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RES = os.path.join(T, 'various', 'results')
key = {**json.load(open(os.path.join(RES, 'r1-config-key.json'))), **json.load(open(os.path.join(RES, 'r1b-config-key.json')))}
blind = {b['name'].replace('.md', ''): b for b in json.load(open(os.path.join(RES, 'blind-key-r1-all.json')))}


def model(c):
    m = c['model'].split('/')[-1]
    return {'gpt-6.2-sol': 'Sol', 'gpt-6.2-astra': 'Astra', 'deepseek-4.1-flash': 'DeepSeek Flash',
            'glm-5.3-flash': 'GLM Flash', 'glm-5.3': 'GLM'}[m]


def harness(c):
    return {'codex': 'Codex', 'pi': 'Pi'}[c['harness']]


def load(name):
    p = os.path.join(RES, 'r1-all-judges', name)
    if not os.path.exists(p):
        return None
    text = open(p).read()
    m = re.search(r'\[\s*\{.*\}\s*\]', text, re.S)
    return json.loads(m.group(0)) if m else None


rows = []
for judge, f in [('Codex judge', 'codex-sol.md'), ('Claude judge', 'claude-opus.json')]:
    arr = load(f)
    if not arr:
        continue
    for d in arr:
        doc = d['doc'].replace('.md', '')
        item = blind[doc]['item']
        c = key[item]
        m_scores = d.get('scores', {})
        rows.append(dict(judge=judge, doc=doc, item=item, model=model(c), harness=harness(c), effort=c['effort'],
                         words=blind[doc].get('words'), overall=d.get('overall'), over_engineering=d.get('over_engineering'),
                         m_total=sum(v for v in m_scores.values() if isinstance(v, (int, float))),
                         M1=m_scores.get('M1'), errors=len(d.get('errors', [])),
                         major=sum(1 for e in d.get('errors', []) if isinstance(e, dict) and e.get('severity') == 'major')))
json.dump(rows, open(os.path.join(RES, 'r1-all-scores.json'), 'w'), indent=1)
for judge in sorted({r['judge'] for r in rows}):
    v = [r for r in rows if r['judge'] == judge]
    print(f'===== {judge}: {len(v)} documents (overall 0-10, OE 0-10 lower is better, M1-M7 total of 35)')
    for r in sorted(v, key=lambda r: -r['overall']):
        print(f"  {r['doc']} {r['item']} {r['model']:14} {r['harness']:5} {r['effort']:6} {r['words']:>6}w  overall {r['overall']:>2}  OE {r['over_engineering']:>2}"
              f"  M {r['m_total']:>2}  M1 {r['M1']}  errors {r['errors']} (major {r['major']})")
    print('  per model:')
    for m in ['Sol', 'Astra', 'DeepSeek Flash', 'GLM Flash', 'GLM']:
        w = [r for r in v if r['model'] == m]
        if w:
            print(f"    {m:14} n={len(w):2}  overall {st.mean(r['overall'] for r in w):.2f}  OE {st.mean(r['over_engineering'] for r in w):.2f}"
                  f"  M {st.mean(r['m_total'] for r in w):.1f}  errors {st.mean(r['errors'] for r in w):.1f}  words {st.mean(r['words'] for r in w):.0f}")
judges = sorted({r['judge'] for r in rows})
if len(judges) == 2:
    a = {r['doc']: r for r in rows if r['judge'] == judges[0]}
    b = {r['doc']: r for r in rows if r['judge'] == judges[1]}
    docs = sorted(a)

    def rank(xs):
        o = sorted(range(len(xs)), key=lambda i: xs[i]); r = [0.0] * len(xs); i = 0
        while i < len(o):
            j = i
            while j + 1 < len(o) and xs[o[j + 1]] == xs[o[i]]:
                j += 1
            for k in range(i, j + 1):
                r[o[k]] = (i + j) / 2
            i = j + 1
        return r
    for k in ['overall', 'over_engineering']:
        ra, rb = rank([a[d][k] for d in docs]), rank([b[d][k] for d in docs])
        ma, mb = st.mean(ra), st.mean(rb)
        cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
        den = (sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb)) ** 0.5
        print(f'Spearman {k} between judges: {cov / den:.2f}' if den else f'Spearman {k}: n/a')
