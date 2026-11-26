# IRWB-004: figures for the report, from the measurements in ../various/.
#   python3 13-figures.py OUTDIR
import json, os, sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

here = os.path.dirname(os.path.abspath(__file__))
various = os.path.join(here, '..', 'various')
out = sys.argv[1] if len(sys.argv) > 1 else various
os.makedirs(out, exist_ok=True)
load = lambda n: json.load(open(os.path.join(various, n)))

# 1. Candela O2, per step: base, this build on the calling thread, this build on four workers
base, local, pool = load('04-candela-o2-baseline.json'), load('15-candela-o2-inc3.json'), load('16-candela-o2-inc3-threads4.json')
labels = [f"{s['pass']}" for s in base['steps']]
x = range(len(labels))
w = 0.28
fig, ax = plt.subplots(figsize=(11, 4.2))
ax.bar([i - w for i in x], [s['ms'] / 1000 for s in base['steps']], w, label=f"base build ({base['passesMs'] / 60000:.1f} min)", color='#9a9a9a')
ax.bar(list(x), [s['ms'] / 1000 for s in local['steps']], w, label=f"this build, calling thread ({local['passesMs'] / 60000:.1f} min)", color='#2b6cb0')
ax.bar([i + w for i in x], [s['ms'] / 1000 for s in pool['steps']], w, label=f"this build, 4 worker threads ({pool['passesMs'] / 60000:.1f} min)", color='#dd8a2e')
ax.set_xticks(list(x))
ax.set_xticklabels(labels, rotation=35, ha='right')
ax.set_ylabel('seconds per pass (pass + gates + meaning check)')
ax.set_title('O2 on Candela, pass by pass; every revision and every check identical in the three runs')
ax.legend(frameon=False, loc='upper left')
ax.spines[['top', 'right']].set_visible(False)
fig.tight_layout()
fig.savefig(os.path.join(out, 'irwb004-o2-per-pass.png'), dpi=150)

# 2. The meaning check alone (r0 against cfg, 13,280 cases): before and after the evaluator's memory reuse
before, after = load('13-candela-contract-threads.json'), load('17-candela-contract-threads-inc3.json')
def series(o):
    r = {x['label']: x['ms'] / 1000 for x in o['runs']}
    return [r['local, no reuse'], r['1 threads, no reuse, warm workers'], r['2 threads, no reuse, warm workers'], r['4 threads, no reuse, warm workers'], r['local, reuse, warm (same candidate)']]
names = ['calling\nthread', '1 worker\n(warm)', '2 workers\n(warm)', '4 workers\n(warm)', 'replayed\n(D1, warm)']
fig, ax = plt.subplots(figsize=(8, 3.8))
x = range(len(names))
ax.bar([i - 0.2 for i in x], series(before), 0.4, label=f"evaluator allocating its stack area per call (load {before['load']})", color='#9a9a9a')
ax.bar([i + 0.2 for i in x], series(after), 0.4, label=f"stack area reused (load {after['load']})", color='#2b6cb0')
for i, v in enumerate(series(after)):
    ax.text(i + 0.2, v + 0.4, f"{v:.2f}" if v < 1 else f"{v:.1f}", ha='center', fontsize=8)
ax.set_xticks(list(x))
ax.set_xticklabels(names)
ax.set_ylabel('seconds')
ax.set_title('The meaning check on Candela (13,280 cases), identical evidence in every run')
ax.legend(frameon=False)
ax.spines[['top', 'right']].set_visible(False)
fig.tight_layout()
fig.savefig(os.path.join(out, 'irwb004-contract-threads.png'), dpi=150)
print('wrote', out)
