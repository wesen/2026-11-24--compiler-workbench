#!/usr/bin/env python3
"""Summarize the hidden T3 evaluation (results/eval-t3.json): per cell, correctness (all checks), kernel counts, and
speed-up (unfused / fused benchmark median) per program, with the geometric mean over the four programs fusion can
change (softmax, layernorm, attention, mlp) and the worst one. Cells from results/t3-config-key.json.
Usage: 44-t3-summary.py"""
import json
import math
import os

T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RES = os.path.join(T, 'various', 'results')
ev = json.load(open(os.path.join(RES, 'eval-t3.json')))
key = json.load(open(os.path.join(RES, 't3-config-key.json')))
names = {'gpt-6.2-sol': 'Sol medium', 'gpt-6.2-astra': 'Astra medium', 'gpt-6.1-terra': 'Terra low', 'claude-opus-5-5': 'Opus',
         'claude-fable-5-2': 'Fable', 'opus': 'Opus', 'fable': 'Fable', 'glm-5.3': 'GLM 5.3 high', 'deepseek-4.1-flash': 'DeepSeek Flash', 'glm-5.3-flash': 'GLM Flash high'}
PROGS = ['softmax', 'layernorm', 'attention', 'mlp']
rows = []
for wt, r in ev.items():
    item = 'IRWB-029-' + wt[-1].upper()
    c = key[item]
    m = c['model'].split('/')[-1]
    label = names.get(m, m) + (f" {c['effort']}" if m == 'deepseek-4.1-flash' else '')
    exact = lambda xs: sum(1 for x in xs if x.get('shapeOk') and x.get('bitExact') == x.get('n'))
    ok = (exact(r['corpus'].values()) == 6 and exact(r['unfused'].values()) == 6 and exact(r['optimized'].values()) == 4
          and exact(r['random']) == 20 and all(v.get('accepted') and v.get('relation') == 'exact' for v in r['check'].values())
          and exact([v.get('fused', {}) for v in r['large'].values()]) == 6)
    sp = {p: r['large'][p]['unfused']['gpuMs'] / r['large'][p]['fused']['gpuMs'] for p in PROGS}
    geo = math.exp(sum(math.log(v) for v in sp.values()) / len(sp))
    rows.append((geo, label, item, ok, {p: r['kernels'][p]['fused'] for p in PROGS}, sp, {p: r['large'][p]['fused']['gpuMs'] for p in PROGS}))
print(f"{'cell':22} {'all exact':9} {'kernels s/l/a/m':16} " + ' '.join(f'{p:>10}' for p in PROGS) + '   geomean  worst')
for geo, label, item, ok, k, sp, ms in sorted(rows, reverse=True):
    print(f"{label:22} {str(ok):9} {'/'.join(str(k[p]) for p in PROGS):16} " + ' '.join(f'{sp[p]:9.2f}x' for p in PROGS) + f"   {geo:6.2f}x  {min(sp.values()):.2f}x")
json.dump([dict(cell=l, item=i, all_exact=o, kernels=k, speedup=s, fused_ms=m, geomean=g) for g, l, i, o, k, s, m in rows],
          open(os.path.join(RES, 'eval-t3-summary.json'), 'w'), indent=1)
