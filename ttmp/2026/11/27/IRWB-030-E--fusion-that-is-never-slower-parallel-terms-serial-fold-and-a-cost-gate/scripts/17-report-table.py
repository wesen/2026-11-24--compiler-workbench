# IRWB-030-E script 17: fills the report's results table and the numbers quoted from it from script 13's output.
#   python3 <ticket>/scripts/17-report-table.py <13-final-table.out.jsonl> <ticket>/scripts/17-report-body.template.txt <report.md>
# The template has TABLE and TABLE_* / RATIO_* tokens; the report keeps its front matter (everything before
# the first top-level heading).
import json, sys

rows = {r['name']: r for r in map(json.loads, open(sys.argv[1]))}
labels = {
    'matmul': 'matmul, M = K = N = 512',
    'softmax': 'softmax, N = 4096, C = 1024',
    'layernorm': 'layernorm, N = 4096, D = 1024 (division outside)',
    'layernorm-inside': 'layernorm, division inside',
    'attention': 'attention, Q = K = 1024, D = V = 64 (division outside)',
    'attention-inside': 'attention, division inside',
    'mlp': 'mlp, N = 1024, D = 256, H = 1024, O = 256',
    'conv2d': 'conv2d, N = 8, C = 16, H = W = 64, O = 32',
}
ms = lambda side: '**%.3f** (%s)' % (side['ms'], ', '.join('%.3f' % t for t in side['times']))
lines = [
    '| Program | Kernels fused / unfused | Launches fused | GPU ms fused (5 calls) | GPU ms unfused (5 calls) | Fused / unfused |',
    '| --- | ---: | ---: | --- | --- | ---: |',
]
ratios = []
for name, label in labels.items():
    r = rows[name]
    assert r['equal'], name
    gated = any(g['gated'] for g in r['plan'])
    if gated:
        ratios.append(r['ratio'])
    lines.append('| %s | %d / %d | %d | %s | %s | %.2f |' % (
        label, r['fused']['kernels'], r['unfused']['kernels'], len(r['plan']), ms(r['fused']), ms(r['unfused']), r['ratio']))
body = open(sys.argv[2]).read()
fill = {
    'TABLE_LNI': '%.3f' % rows['layernorm-inside']['fused']['ms'],
    'TABLE_ATI': '%.3f' % rows['attention-inside']['fused']['ms'],
    'TABLE_ATR': '%.2f' % rows['attention-inside']['ratio'],
    'TABLE_MLP': '%.3f' % rows['mlp']['fused']['ms'],
    'TABLE_SMI': '%.3f' % rows['softmax-inside']['fused']['ms'],
    'TABLE_SMU': '%.3f' % rows['softmax-inside']['unfused']['ms'],
    'RATIO_MIN': '%.2f' % min(ratios),
    'RATIO_MAX': '%.2f' % max(ratios),
    'TABLE': '\n'.join(lines),
}
for token in sorted(fill, key=len, reverse=True):
    assert token in body, token
    body = body.replace(token, fill[token])
report = open(sys.argv[3]).read()
front = report.split('\n# ')[0]
open(sys.argv[3], 'w').write(front + '\n' + body)
print('\n'.join(lines))
