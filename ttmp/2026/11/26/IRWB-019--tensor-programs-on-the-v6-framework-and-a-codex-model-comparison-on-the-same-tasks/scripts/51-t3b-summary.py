#!/usr/bin/env python3
"""Summarize the hidden T3b evaluation (results/eval-t3b.json): per worktree, whether every check is exact (the T3
evaluation's corpus, unfused, optimized, random, check and large bits, plus each extra program's fused and unfused bits
and its checkLowering verdict), and the speed-up (unfused / fused benchmark median) on the four fusable hidden programs
and the five extra programs, with the geometric mean over all nine and the worst. Writes results/eval-t3b-summary.json.
Usage: 51-t3b-summary.py"""
import json, math, os
T = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RES = os.path.join(T, 'various', 'results')
ev = json.load(open(os.path.join(RES, 'eval-t3b.json')))
key = json.load(open(os.path.join(RES, 't3b-config-key.json')))
names = {'gpt-6.2-sol': 'Sol medium', 'gpt-6.2-astra': 'Astra medium', 'gpt-6.1-terra': 'Terra low', 'opus': 'Opus', 'fable': 'Fable',
         'glm-5.3': 'GLM 5.3', 'deepseek-4.1-flash': 'DeepSeek Flash', 'glm-5.3-flash': 'GLM Flash high'}
HID = ['softmax', 'layernorm', 'attention', 'mlp']
EXT = ['layernorm_out', 'attention_out', 'rmsnorm_in', 'center_in', 'logsoftmax']
ex = lambda x: bool(x) and x.get('shapeOk', True) and x.get('bitExact') == x.get('n')
rows = []
for wt, r in ev.items():
    if wt == 't3b-baseline': label, item = 'baseline (main, T3 Opus)', '-'
    else:
        item = 'IRWB-030-' + wt[-1].upper(); c = key[item]; m = c['model'].split('/')[-1]
        label = names[m] + (f" {c['effort']}" if m in ('deepseek-4.1-flash', 'glm-5.3') else '')
    t3 = r['t3']
    ok = (all(ex(v) for v in t3['corpus'].values()) and all(ex(v) for v in t3['unfused'].values()) and all(ex(v) for v in t3['optimized'].values())
          and all(ex(v) for v in t3['random']) and all(v.get('accepted') and v.get('relation') == 'exact' for v in t3['check'].values())
          and all(ex(v['fused']) for v in t3['large'].values())
          and all(ex(r['extra'][p]['fused']) and ex(r['extra'][p]['unfused']) and r['extra'][p]['check']['accepted'] and r['extra'][p]['check']['relation'] == 'exact' for p in EXT))
    sp = {p: t3['large'][p]['unfused']['gpuMs'] / t3['large'][p]['fused']['gpuMs'] for p in HID}
    sp.update({p: r['extra'][p]['unfused']['gpuMs'] / r['extra'][p]['fused']['gpuMs'] for p in EXT})
    geo = math.exp(sum(math.log(v) for v in sp.values()) / len(sp))
    rows.append(dict(cell=label, item=item, all_exact=ok, speedup={k: round(v, 3) for k, v in sp.items()}, geomean=round(geo, 3), worst=round(min(sp.values()), 3), worst_program=min(sp, key=sp.get)))
rows.sort(key=lambda x: -x['geomean'])
json.dump(rows, open(os.path.join(RES, 'eval-t3b-summary.json'), 'w'), indent=1)
cols = HID + EXT
print(f"{'cell':26} {'exact':5} " + ' '.join(f'{c[:9]:>9}' for c in cols) + '  geomean  worst')
for x in rows:
    print(f"{x['cell']:26} {str(x['all_exact']):5} " + ' '.join(f"{x['speedup'][c]:8.2f}x" for c in cols) + f"  {x['geomean']:6.2f}x  {x['worst']:.2f}x ({x['worst_program']})")
