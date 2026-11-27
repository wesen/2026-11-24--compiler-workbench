#!/usr/bin/env python3
"""Fill the report's @@...@@ markers from the measurement outputs in various/, so no number is typed by hand.
usage: python3 23-fill-report.py   (run from anywhere; rewrites reference/02-report-*.md in place)"""
import glob, json, os, subprocess
here = os.path.dirname(os.path.abspath(__file__))
V = os.path.join(here, '..', 'various')
report = glob.glob(os.path.join(here, '..', 'reference', '02-report-*.md'))[0]
s = open(report).read()
n = lambda x: f'{x:,}'
d = lambda x: ('+' if x > 0 else '') + n(x)
table = lambda f: subprocess.run(['node', os.path.join(here, '20-ablation-table.mjs'), os.path.join(V, f)], capture_output=True, text=True, check=True).stdout.strip()
sp = json.load(open(os.path.join(V, '09-ablation-speed.json')))['totals']
o2 = json.load(open(os.path.join(V, '09-ablation-O2.json')))['totals']
diff = lambda a, b: f"{d(sp[a]['default'] - sp[b]['default'])} with the default options, {d(sp[a]['tuned'] - sp[b]['tuned'])} tuned"
o2a, o2b = list(o2.values())[0], list(o2.values())[1]
fills = {
    '@@ABLATION_SPEED@@': table('09-ablation-speed.json'),
    '@@ABLATION_O2@@': table('09-ablation-O2.json'),
    '@@O2_LINE@@': f"{n(o2a['default'])} to {n(o2b['default'])} with the default options ({100 * (o2b['default'] - o2a['default']) / o2a['default']:.1f}%), {n(o2a['tuned'])} to {n(o2b['tuned'])} tuned ({100 * (o2b['tuned'] - o2a['tuned']) / o2a['tuned']:.1f}%)",
    '@@ONE_THREAD@@': f"{n(sp['all, one thread']['default'])} over the corpus, two give {n(sp['all']['default'])}",
    '@@ALL_BRANCH@@': diff('all, guards on every branch', 'all'),
    '@@COPIES_ALONE@@': diff('copies', 'old'),
    '@@COPIES_WHOLE@@': f"{n(sp['all, copies whole']['default'])} against {n(sp['all']['default'])} in the full list (default options), {n(sp['all, copies whole']['tuned'])} against {n(sp['all']['tuned'])} tuned",
    '@@SUBST_ALONE@@': diff('subst-mem', 'old'),
    '@@THREAD_SUBST@@': diff('thread+subst-mem', 'thread'),
}
ev = os.path.join(here, '..', '..', '..', '..', '..', '..', 'src', 'typed', 'rules', 'evidence-identities.ts')
text = open(ev).read()
records = json.loads(text[text.index('= {', text.index('IDENTITY_EVIDENCE:')) + 2:].rstrip().rstrip(';'))
for i, name in enumerate(['shl-shr3-mask', 'lt-and15-8', 'shl-shl-one'], 1):
    e = records[name]
    how = [m for m in e['methods'] if m['verdict'] == 'pass' and m['method'] in ('exhaustive-32', 'symbolic-linear')]
    fills[f'@@EV{i}@@'] = f"{e['strength']} ({', '.join(m['method'] + (' over ' + n(m['cases']) + ' inputs' if m.get('cases') else '') for m in how)})"
for k, v in fills.items():
    assert k in s, k
    s = s.replace(k, v)
open(report, 'w').write(s)
left = [w for w in s.split() if w.startswith('@@')]
print('filled', len(fills), 'markers; left:', left)
