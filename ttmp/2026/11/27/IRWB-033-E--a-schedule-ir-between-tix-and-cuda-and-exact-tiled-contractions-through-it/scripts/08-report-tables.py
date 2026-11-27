# IRWB-033-E script 08: print the report's tables from the measurement files (05 parts, 05 large, 06, 07).
# python3 08-report-tables.py  (run in scripts/)
import json, os
here = os.path.dirname(os.path.abspath(__file__))
def rows(name):
    out = []
    path = os.path.join(here, name)
    if not os.path.exists(path): return out
    for line in open(path):
        try: out.append(json.loads(line))
        except Exception: pass
    return out
bench = {r['label']: r for f in ['05-benchmark-part1.out.jsonl', '05-benchmark-part2.out.jsonl', '05-benchmark-large.out.jsonl'] for r in rows(f)}
cfg = {0: '64 × 64 / 4 × 4 / 16', 1: '32 × 32 / 2 × 2 / 32', 2: 'stage 2'}
def chosen(r):
    c = r.get('chosen', {})
    parts = [f"{k}: {cfg[v]}" for k, v in (c.get('tiles') or {}).items()] + [f"{k}: block mode" if v == 'fused' else f"{k}: by statement" for k, v in (c.get('gates') or {}).items()]
    return '; '.join(parts)
print('TABLE')
print('| Program | Definitions | Fused ms | Base (3b) ms | Unfused ms | Fused / base | Fused / unfused | Chosen at launch |')
print('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
for label in ['matmul-512', 'matmul-4096', 'softmax', 'layernorm', 'attention', 'mlp', 'conv2d']:
    r = bench.get(label)
    if not r: continue
    m = r['median']; base = m.get('base', m['unfused'])
    print(f"| {label} | {r['definitions']} | **{m['fused']:.4g}** | {base:.4g} | {m['unfused']:.4g} | {m['fused']/base:.2f} | {m['fused']/m['unfused']:.2f} | {chosen(r)} |")
print()
print('CONTRACTIONS')
macs = {'matmul-512': 512**3, 'matmul-4096': 4096**3, 'attention.score': 1024*1024*64, 'attention.out': 1024*64*1024, 'mlp.h': 1024*1024*256, 'mlp.y': 1024*256*1024, 'conv2d': 8*32*62*62*144}
cublas = {'matmul-512': 0.0329, 'attention.score': 0.0177, 'attention.out': 0.0216, 'mlp.h': 0.0423, 'mlp.y': 0.0475}
print('| Contraction (M × N outputs, K terms) | Fused ms | Unfused ms | Fused TFLOP/s | Unfused TFLOP/s | cuBLAS ms | cuBLAS / fused | Configuration |')
print('| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |')
for label, n in macs.items():
    r = bench.get(label)
    if not r: continue
    m = r['median']
    tf = lambda ms: 2 * n / (ms * 1e-3) / 1e12
    cb = cublas.get(label)
    ratio = f"{cb / m['fused']:.2f}" if cb else ('0.35 (19.2 TFLOP/s)' if label == 'matmul-4096' else '')
    print(f"| {label} | **{m['fused']:.4g}** | {m['unfused']:.4g} | {tf(m['fused']):.2f} | {tf(m['unfused']):.2f} | {cb or ''} | {ratio} | {chosen(r)} |")
print()
print('THRESHOLD')
print('| M × K × N | Tiles 64 × 64 | Tiles 32 × 32 | Config 0 ms | Config 1 ms | Stage 2 ms | The final rule picks | Fastest |')
print('| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |')
for r in rows('07-tile-threshold.out.jsonl'):
    if 'shape' not in r: continue
    ms = r['ms']; enough = r['shape'][1] >= 64  # the final rule also asks for 64 terms
    pick = 'tile64' if enough and r['tiles64'] >= 64 else 'tile32' if enough and r['tiles32'] >= 64 else 'stage2'
    best = min(ms, key=ms.get)
    print(f"| {' × '.join(map(str, r['shape']))} | {r['tiles64']} | {r['tiles32']} | {ms['tile64']:.4g} | {ms['tile32']:.4g} | {ms['stage2']:.4g} | {pick} ({ms[pick]/ms['stage2']:.2f} of stage 2) | {best} |")
print()
print('SMALL')
print('| Program and shapes | Fused ms | Base (3b) ms | Unfused ms | Fused / base | Chosen |')
print('| --- | ---: | ---: | ---: | ---: | --- |')
for r in rows('07-tile-threshold.out.jsonl'):
    if 'name' not in r: continue
    ms = r['ms']; d = ', '.join(f"{k} {v}" for k, v in list(r['dims'].items())[:2])
    print(f"| {r['name']}: {d} | {ms['fused']:.4g} | {ms['base']:.4g} | {ms['unfused']:.4g} | {ms['fused']/ms['base']:.2f} | {chosen(r)} |")
print()
print('COST')
print('| Program | Form | Accepted | Sides (GPU runs) | Definitions | Wall |')
print('| --- | --- | --- | ---: | ---: | ---: |')
for r in rows('06-check-programs.out.jsonl'):
    print(f"| {r['name']} | {r['form']}, {'fused' if r['fuse'] else 'unfused'} | {'exact' if r['accepted'] else 'REJECTED: ' + str(r.get('reason'))[:80]} | {r['sides']} | {r['definitions']} | {r['wallMs']/1000:.1f} s |")
