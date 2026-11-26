"""Figures for the IR Workbench synthesis report (report 9).

    python3 -I 17-synthesis-figures.py <out-dir>

Writes:
  irwb-synthesis-ladder.png  B-01 and R-01 instructions per pixel at each stage, stride 4 (1,600 pixels).
      Stages 1-3: report 4 (per-scene kernels), tables "scene images" and "O2+ on the specialized program".
      Stages 4-5 and the reference: report 8 (IRWB-003), table of B-01/R-01 per scene.
      The 6,000 line is IRWB-007's first falsifier (design doc section 24, item 1).
  irwb-synthesis-bounds.png  IRWB-007's binding-time bounds per scene, parsed from
      ttmp/2026/11/26/IRWB-007--*/various/04-profile-summary.txt (data(dce), gen(dce), control; lo-hi).
"""
import glob
import os
import re
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "..", "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "various", "figures")
os.makedirs(OUT, exist_ok=True)

INK, MUTED, GRID = "#1f2328", "#57606a", "#d0d7de"
C_STAGE = ["#8c959f", "#54aeff", "#218bff", "#0969da", "#0550ae"]
C_REF, C_GOAL = "#cf222e", "#bf8700"
C_POLY, C_GEN, C_MONO = "#0969da", "#54aeff", "#8c959f"

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

# --- figure 1: the ladder -------------------------------------------------------------------------
stages = [
    "general\nr0",
    "per-scene\nbind + dfe",
    "per-scene\nO2+",
    "per-scene\nspeed",
    "per-scene\nspeed +\n3 options",
]
ladder = {
    "B-01 (one sphere, one plane)": ([11200, 10494, 10435, 8749.1, 8267.7], 8501, 6000),
    "R-01 (Cornell box)": ([24070, 22882, 22850.9, 19314.3, 18186.7], 15655.9, None),
}
fig, axes = plt.subplots(1, 2, figsize=(11, 4.6), sharey=False)
for ax, (title, (vals, ref, goal)) in zip(axes, ladder.items()):
    xs = range(len(vals))
    bars = ax.bar(xs, vals, color=C_STAGE, width=0.7)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v * 1.01, f"{v:,.1f}".rstrip("0").rstrip("."),
                ha="center", va="bottom", fontsize=8, color=INK)
    ax.axhline(ref, color=C_REF, lw=1.2, ls="-", label=f"reference compiler, kernel: {ref:,.1f}".replace(".0:", ":").rstrip("0").rstrip("."))
    if goal:
        ax.axhline(goal, color=C_GOAL, lw=1.2, ls="--", label="IRWB-007 falsifier: 6,000")
    ax.legend(loc="upper right", fontsize=8, frameon=False)
    ax.set_xticks(list(xs))
    ax.set_xticklabels(stages, fontsize=8, rotation=0)
    ax.set_title(title, fontsize=10, color=INK)
    ax.set_ylabel("instructions per pixel (stride 4)")
    ax.grid(axis="y", color=GRID, lw=0.5)
    ax.set_axisbelow(True)
    ax.set_ylim(0, max(vals) * 1.3)
fig.suptitle("Every output float bit-identical to the reference frame at every stage", fontsize=9, color=MUTED, y=0.995)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "irwb-synthesis-ladder.png"))
plt.close(fig)

# --- figure 2: IRWB-007 bounds -----------------------------------------------------------------------
summary = glob.glob(os.path.join(ROOT, "ttmp/2026/11/26/IRWB-007--*/various/04-profile-summary.txt"))[0]
rows = []
pat = re.compile(r"^(\w-\d\d)\s+\d+\s+\d+\s+\d+\s+\d+\s+\|\s+[\d.]+\s+([\d.]+)-([\d.]+)\s+([\d.]+)-([\d.]+)\s+([\d.]+)-([\d.]+)\s+\|")
with open(summary) as fh:
    for line in fh:
        m = pat.match(line)
        if m:
            sc = m.group(1)
            d = (float(m.group(2)), float(m.group(3)))
            g = (float(m.group(4)), float(m.group(5)))
            c = (float(m.group(6)), float(m.group(7)))
            rows.append((sc, d, g, c))
assert len(rows) == 18, len(rows)
rows.sort(key=lambda r: r[1][0])
fig, ax = plt.subplots(figsize=(9, 5.6))
for i, (sc, d, g, c) in enumerate(rows):
    for (lo, hi), off, col, lab in ((d, 0.26, C_POLY, "polyvariant (data)"),
                                    (g, 0.0, C_GEN, "polyvariant, merging at returns (gen)"),
                                    (c, -0.26, C_MONO, "monovariant (control)")):
        ax.plot([lo, hi], [i + off, i + off], color=col, lw=5, solid_capstyle="butt",
                label=lab if i == 0 else None)
ax.axvline(2.0, color=C_GOAL, lw=1, ls="--")
ax.text(2.02, -1.0, "2×", color=C_GOAL, fontsize=8, va="bottom")
ax.set_yticks(range(len(rows)))
ax.set_yticklabels([r[0] for r in rows], fontsize=8)
ax.set_xlabel("bound on the per-pixel gain (operations before / operations after ideal specialization)")
ax.set_title("IRWB-007: what a specializer could at most remove, per scene (evaluator operations at r0, stride 8)",
             fontsize=9.5, color=INK)
ax.grid(axis="x", color=GRID, lw=0.5)
ax.set_axisbelow(True)
ax.legend(loc="lower right", fontsize=8, frameon=False)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "irwb-synthesis-bounds.png"))
plt.close(fig)
print("wrote", OUT)
