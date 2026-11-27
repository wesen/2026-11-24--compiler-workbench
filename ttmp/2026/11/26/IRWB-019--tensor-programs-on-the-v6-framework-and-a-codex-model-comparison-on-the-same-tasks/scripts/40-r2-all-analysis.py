#!/usr/bin/env python3
"""R2 with the R2b cells (11 tickets): map each judge's scores through the blind key and print per-cell and per-model
scores for every judge present (all R2 rubric dimensions, error counts), plus agreement between judges.

Judges: results/r2-all-judges/codex-sol.md (the Codex judge's final message) and results/r2-all-judges/claude-opus.md
(copied from the pack directory). Writes results/r2-all-scores.json. Usage: 40-r2-all-analysis.py
"""
import json
import os
import re
import statistics as st

T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RES = os.path.join(T, 'various', 'results')
key = {**json.load(open(os.path.join(RES, 'r2-config-key.json'))), **json.load(open(os.path.join(RES, 'r2b-config-key.json')))}
blind = {b['name']: b['item'] for b in json.load(open(os.path.join(RES, 'blind-key-r2-all.json')))}
DIMS = ['ingenuity', 'creativity', 'scientific_depth', 'evidence', 'correctness', 'grounding', 'padding', 'overall']


def model(c):
    m = c['model'].split('/')[-1]
    for k, n in [('sol', 'Sol'), ('astra', 'Astra'), ('opus', 'Opus'), ('fable', 'Fable'), ('deepseek', 'DeepSeek Flash'),
                 ('glm-5.3-flash', 'GLM Flash'), ('glm-5.3', 'GLM')]:
        if k in m:
            return n
    raise ValueError(m)


family = lambda m: {'Sol': 'OpenAI', 'Astra': 'OpenAI', 'Opus': 'Anthropic', 'Fable': 'Anthropic'}.get(m, 'other')
rows = []
for judge, f in [('Codex judge', 'codex-sol.md'), ('Claude judge', 'claude-opus.md')]:
    p = os.path.join(RES, 'r2-all-judges', f)
    if not os.path.exists(p):
        continue
    m = re.search(r'\[\s*\{.*\}\s*\]', open(p).read(), re.S)
    if not m:
        print(f'{judge}: no JSON array found'); continue
    for d in json.loads(m.group(0)):
        doc = d['doc'].replace('.md', '').rstrip('/')
        item = blind[doc]
        c = key[item]
        rows.append(dict(judge=judge, doc=doc, item=item, model=model(c), family=family(model(c)), effort=c['effort'],
                         **{k: d['scores'].get(k) for k in DIMS}, errors=len(d.get('errors') or [])))
json.dump(rows, open(os.path.join(RES, 'r2-all-scores.json'), 'w'), indent=1)
order = ['Astra', 'Sol', 'Opus', 'Fable', 'DeepSeek Flash', 'GLM', 'GLM Flash']
for judge in sorted({r['judge'] for r in rows}):
    v = [r for r in rows if r['judge'] == judge]
    print(f'===== {judge}: {len(v)} tickets (0-10; padding lower is better)')
    for r in sorted(v, key=lambda r: -r['overall']):
        print(f"  {r['doc']} {r['item']} {r['model']:14} {r['effort']:7} overall {r['overall']:>2}  " +
              ' '.join(f"{k[:5]} {r[k]}" for k in DIMS[:-1]) + f"  errors {r['errors']}")
    print('  per model (means):')
    for mname in order:
        w = [r for r in v if r['model'] == mname]
        if w:
            print(f"    {mname:14} n={len(w)}  overall {st.mean(r['overall'] for r in w):.2f}  creat {st.mean(r['creativity'] for r in w):.2f}"
                  f"  depth {st.mean(r['scientific_depth'] for r in w):.2f}  evid {st.mean(r['evidence'] for r in w):.2f}"
                  f"  corr {st.mean(r['correctness'] for r in w):.2f}  pad {st.mean(r['padding'] for r in w):.2f}  errors {st.mean(r['errors'] for r in w):.1f}")
judges = sorted({r['judge'] for r in rows})
if len(judges) == 2:
    a = {r['doc']: r for r in rows if r['judge'] == judges[0]}
    b = {r['doc']: r for r in rows if r['judge'] == judges[1]}
    print('mean overall of both judges, per model:')
    for mname in order:
        ds = [d for d in a if a[d]['model'] == mname]
        if ds:
            print(f"  {mname:14} {st.mean((a[d]['overall'] + b[d]['overall']) / 2 for d in ds):.2f}"
                  f"  ({judges[0]} {st.mean(a[d]['overall'] for d in ds):.2f}, {judges[1]} {st.mean(b[d]['overall'] for d in ds):.2f})")
