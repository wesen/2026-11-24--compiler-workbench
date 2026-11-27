#!/usr/bin/env python3
"""Build the scorecard artifact's data files for the new sections (report 11 sections 11 and 12):
families.json (R1 and R2 with the DeepSeek and GLM cells, one row per judge and document), t3.json (stage 3, one row
per cell, from the hidden evaluation) and placement.json (scripts/43's division-placement probe).
Writes them to results/scorecard/. Usage: 48-scorecard-data.py"""
import json, os, re
T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RES = os.path.join(T, 'various', 'results')
OUT = os.path.join(RES, 'scorecard'); os.makedirs(OUT, exist_ok=True)
fam = lambda m: {'Sol': 'OpenAI', 'Astra': 'OpenAI', 'Opus': 'Anthropic', 'Fable': 'Anthropic'}.get(m, 'DeepSeek/GLM')
rows = []
for r in json.load(open(os.path.join(RES, 'r1-all-scores.json'))):
    rows.append(dict(round='R1', item=r['item'], model=r['model'], family=fam(r['model']), harness=r['harness'], effort=r['effort'], judge=r['judge'], overall=r['overall'], errors=r['errors'], words=r['words']))
for r in json.load(open(os.path.join(RES, 'r2-all-scores.json'))):
    rows.append(dict(round='R2', item=r['item'], model=r['model'], family=fam(r['model']), harness='Codex' if r['model'] in ('Sol', 'Astra') else ('Claude Code' if r['model'] in ('Opus', 'Fable') else 'Pi'), effort=r['effort'], judge=r['judge'], overall=r['overall'], errors=r['errors'], words=None))
json.dump(rows, open(os.path.join(OUT, 'families.json'), 'w'), indent=1)
minutes = {'Sol medium': 15, 'Astra medium': 10, 'Terra low': 4, 'Opus': 54, 'Fable': 43, 'GLM 5.3 high': 71, 'DeepSeek Flash high': 45, 'DeepSeek Flash xhigh': 56, 'GLM Flash high': 77}
t3 = []
for r in json.load(open(os.path.join(RES, 'eval-t3-summary.json'))):
    c = r['cell']
    t3.append(dict(cell=c, item=r['item'], harness='Codex' if c.split()[0] in ('Sol', 'Astra', 'Terra') else ('Claude Code' if c in ('Opus', 'Fable') else 'Pi'), minutes=minutes[c], all_exact=r['all_exact'],
                   **{f'k_{p}': r['kernels'][p] for p in r['kernels']}, **{f'x_{p}': round(v, 3) for p, v in r['speedup'].items()}, geomean=round(r['geomean'], 3), worst=round(min(r['speedup'].values()), 3), merged=c == 'Opus'))
json.dump(t3, open(os.path.join(OUT, 't3.json'), 'w'), indent=1)
pl = []
names = {'t3-op-irwb-029-d': 'Opus', 't3-am-irwb-029-b': 'Astra medium', 't3-gf-h-irwb-029-i': 'GLM Flash high', 't3-sm-irwb-029-a': 'Sol medium'}
for line in open(os.path.join(RES, 'division-placement.txt')):
    m = re.match(r'(\S+)\s+(\w+)\s+division (inside|outside)\s+fused ([\d.]+) ms \((\d+) kernels\)\s+unfused ([\d.]+) ms', line)
    if m: pl.append(dict(cell=names[m[1]], program=m[2], placement=m[3], fused_ms=float(m[4]), kernels=int(m[5]), unfused_ms=float(m[6]), speedup=round(float(m[6]) / float(m[4]), 3)))
json.dump(pl, open(os.path.join(OUT, 'placement.json'), 'w'), indent=1)
print(len(rows), len(t3), len(pl))
