"""Figures for the IRWB-003 report, from the measurement files in ../various/.

    python3 -I 10-report-figures.py <out-dir>

Writes irwb003-benchmarks.png, irwb003-corpus-ablation.png, irwb003-corpus-projects.png and, when
various/11-candela-scenes-speed.json exists, irwb003-candela-scenes.png.
"""
import json
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import matplotlib.ticker  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
VAR = os.path.join(HERE, "..", "various")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(VAR, "figures")
os.makedirs(OUT, exist_ok=True)

INK, MUTED, GRID = "#1f2328", "#57606a", "#d0d7de"
C_BOOK, C_PASSES, C_ALL, C_REF = "#8c959f", "#54aeff", "#0969da", "#cf222e"

plt.rcParams.update(
    {
        "font.family": "DejaVu Sans",
        "font.size": 10,
        "axes.edgecolor": GRID,
        "axes.labelcolor": INK,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "axes.spines.top": False,
        "axes.spines.right": False,
        "figure.dpi": 150,
    }
)


def load(name):
    with open(os.path.join(VAR, name)) as f:
        return json.load(f)


def save(fig, name, bottom=0.0):
    fig.tight_layout(rect=(0, bottom, 1, 1))
    fig.savefig(os.path.join(OUT, name), facecolor="white")
    plt.close(fig)
    print("wrote", name)


# 1. the book's benchmarks
o2 = {r["id"]: r for r in load("06-benchmarks-o2.json")["rows"]}
sd = {r["id"]: r for r in load("12-benchmarks-speed-defaults.json")["rows"]}
sa = {r["id"]: r for r in load("12-benchmarks-speed-all-options.json")["rows"]}
names = ["blend", "checksum", "sort", "collatz", "value-numbering"]
series = [
    ("O2, default options (the book)", [o2[n]["ours"] for n in names], C_BOOK),
    ("speed, default options", [sd[n]["ours"] for n in names], C_PASSES),
    ("speed, chains + coalesce + homes", [sa[n]["ours"] for n in names], C_ALL),
    ("reference compiler", [o2[n]["ref"] for n in names], C_REF),
]
fig, axes = plt.subplots(1, len(names), figsize=(11, 3.4))
for ax, i, n in zip(axes, range(len(names)), names):
    vals = [s[1][i] for s in series]
    bars = ax.bar(range(len(series)), vals, color=[s[2] for s in series], width=0.75)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v, str(v), ha="center", va="bottom", fontsize=8, color=INK)
    ax.set_title(n, fontsize=10, color=INK)
    ax.set_xticks([])
    ax.set_ylim(0, max(vals) * 1.15)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)
axes[0].set_ylabel("instructions executed")
fig.legend(
    [plt.Rectangle((0, 0), 1, 1, color=s[2]) for s in series],
    [s[0] for s in series],
    loc="lower center",
    ncol=4,
    frameon=False,
    bbox_to_anchor=(0.5, -0.02),
)

save(fig, "irwb003-benchmarks.png", 0.1)

# 2. the corpus: which option buys what, on top of the speed pipeline
c10 = load("10-corpus-o3-all-options.json")
rows = [
    ("O2, default options (the book)", c10["total"]["base"]["instructions"], C_BOOK),
    ("speed, default options", load("13-corpus-speed-defaults.json")["total"]["instructions"], C_PASSES),
    ("speed + chains", load("13-corpus-speed-chainstrue.json")["total"]["instructions"], C_ALL),
    ("speed + coalesce", load("13-corpus-speed-coalescetrue.json")["total"]["instructions"], C_ALL),
    ("speed + homes", load("13-corpus-speed-homestrue.json")["total"]["instructions"], C_ALL),
    ("speed + all three", c10["total"]["instructions"], C_ALL),
]
fig, ax = plt.subplots(figsize=(8, 3.2))
y = list(range(len(rows)))[::-1]
ax.barh(y, [r[1] for r in rows], color=[r[2] for r in rows], height=0.65)
base = rows[0][1]
for yy, r in zip(y, rows):
    ax.text(r[1], yy, f"  {r[1]:,}  ({100 * (r[1] - base) / base:+.1f}%)", va="center", fontsize=9, color=INK)
ax.set_yticks(y)
ax.set_yticklabels([r[0] for r in rows])
ax.set_xlim(0, base * 1.32)
ax.xaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v / 1000:,.0f}k"))
ax.set_xlabel("instructions over the corpus's decided cases (44 projects, 6,986 cases)")
ax.grid(axis="x", color=GRID, linewidth=0.6)
ax.set_axisbelow(True)
save(fig, "irwb003-corpus-ablation.png")

# 3. per project: speed with all three options against O2
pr = sorted(
    ((r["id"], r["instructions"] / r["base"]["instructions"]) for r in c10["rows"] if r["base"]["instructions"]),
    key=lambda x: x[1],
)
fig, ax = plt.subplots(figsize=(11, 3.6))
ax.bar(range(len(pr)), [100 * v for _, v in pr], color=C_ALL, width=0.7)
ax.axhline(100, color=C_BOOK, linewidth=1)
ax.set_xticks(range(len(pr)))
ax.set_xticklabels([n for n, _ in pr], rotation=75, fontsize=7)
ax.set_ylabel("% of O2's instructions")
ax.set_ylim(0, 110)
ax.grid(axis="y", color=GRID, linewidth=0.6)
ax.set_axisbelow(True)
save(fig, "irwb003-corpus-projects.png")

# 4. Candela per scene, instructions per pixel. O2+ on the scene program, when the run did not measure it: B-01 from
# various/11a-candela-scenes-speed-first-run.log (this build), R-01 from IRWB-001 various/experiments/08-candela-per-scene-o2.json
O2PLUS = {"B-01": 10435, "R-01": 22850.9}
path = os.path.join(VAR, "11-candela-scenes-speed.json")
if os.path.exists(path) and os.path.getsize(path) > 0:
    sc = load("11-candela-scenes-speed.json")
    labels = [
        ("reference kernel", lambda r: r["referenceKernel"], C_REF),
        ("O2+, default options", lambda r: r["o2plus"]["perPixel"] if "o2plus" in r else O2PLUS[r["scene"]], C_BOOK),
        ("speed, default options", lambda r: r["speed"]["defaults"]["perPixel"], C_PASSES),
        ("speed, chains + coalesce + homes", lambda r: r["speed"]["options"]["perPixel"], C_ALL),
    ]
    fig, axes = plt.subplots(1, len(sc), figsize=(4.2 * len(sc), 3.4))
    if len(sc) == 1:
        axes = [axes]
    for ax, r in zip(axes, sc):
        vals = [f(r) for _, f, _ in labels]
        bars = ax.bar(range(len(labels)), vals, color=[c for _, _, c in labels], width=0.75)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v, f"{v:,.0f}", ha="center", va="bottom", fontsize=8, color=INK)
        ax.set_title(f"scene {r['scene']} (stride {r['stride']}, {r['pixels']} pixels)", fontsize=10, color=INK)
        ax.set_xticks([])
        ax.set_ylim(0, max(vals) * 1.15)
        ax.grid(axis="y", color=GRID, linewidth=0.6)
        ax.set_axisbelow(True)
    axes[0].set_ylabel("instructions per pixel")
    fig.legend(
        [plt.Rectangle((0, 0), 1, 1, color=c) for _, _, c in labels],
        [n for n, _, _ in labels],
        loc="lower center",
        ncol=2,
        frameon=False,
        bbox_to_anchor=(0.5, -0.02),
    )

    save(fig, "irwb003-candela-scenes.png", 0.2)
