"""Figures for the IRWB-005 report, from the run records (no numbers typed by hand).

  python3 -I ttmp/2026/11/25/IRWB-005--*/scripts/14-figures.py <records.jsonl> <outdir>

<records.jsonl> is the corpus run after the deep reclassification (various/10-corpus-final-deep.jsonl).
Writes irwb005-wrong-accepted-by-gate.png, irwb005-classes-by-operator.png, irwb005-kill-rate-by-operator.png.
Colours: the dataviz reference palette's light steps; text in neutral ink.
"""
import json
import sys
from collections import Counter, defaultdict

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
BLUE, ORANGE, AQUA, YELLOW, MAGENTA = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"

records = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
out = sys.argv[2]


def cls(r, g):
    """The class of a mutant from one gate's point of view (as tools/mutation-classify.mjs classOf)."""
    if r.get("invalid"):
        return "invalid"
    v = r["gates"].get(g, {}).get("verdict")
    if v is None:
        return None
    if v.startswith("killed"):
        return "killed"
    return (r.get("classification") or {}).get("class", "unclassified")


def style(ax):
    ax.set_facecolor(SURFACE)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(GRID)
    ax.tick_params(colors=INK2, labelsize=9)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


# 1. wrong mutants accepted, per gate configuration
GATES = [
    ("default", "version 1, 40 cases (Program.apply)"),
    ("default80", "version 1, 80 cases"),
    ("check100", "version 1, 100 cases (Program.check)"),
    ("strong-cases", "40 + 40 boundary cases"),
    ("default+div", "40 cases + divergence rule"),
    ("strong", "version 2: 40 + 40 boundary + divergence"),
]
counts = [sum(1 for r in records if cls(r, g) == "survived-wrong") for g, _ in GATES]
fig, ax = plt.subplots(figsize=(7.2, 3.2), dpi=160)
fig.patch.set_facecolor(SURFACE)
style(ax)
y = range(len(GATES))[::-1]
ax.barh(list(y), counts, height=0.55, color=BLUE)
for yi, c in zip(y, counts):
    ax.text(c + 0.6, yi, str(c), va="center", fontsize=9, color=INK)
ax.set_yticks(list(y), [label for _, label in GATES], color=INK, fontsize=9)
ax.set_xlabel("wrong mutants accepted (of 1,144 corpus mutants)", color=INK2, fontsize=9)
ax.set_title("Wrong mutants each gate configuration accepts", color=INK, fontsize=10, loc="left")
fig.tight_layout()
fig.savefig(f"{out}/irwb005-wrong-accepted-by-gate.png", facecolor=SURFACE)

# 2. classes per operator under the default gate (stacked, 2px surface gaps)
ops = ["const", "cmp-flip", "cmp-weaken", "swap", "shift", "drop-check", "check-range", "hoist-trap", "drop-store"]
CLASSES = [
    ("killed", "killed", BLUE),
    ("survived-wrong", "accepted, wrong", ORANGE),
    ("equivalent-spec-proved", "equivalent (exhaustive)", AQUA),
    ("equivalent-spec", "equivalent under the spec only", YELLOW),
    ("equivalent-presumed", "equivalent (presumed)", MAGENTA),
]
tab = defaultdict(Counter)
for r in records:
    c = cls(r, "default")
    if c:
        tab[r["operator"]][c] += 1
fig, ax = plt.subplots(figsize=(7.2, 3.6), dpi=160)
fig.patch.set_facecolor(SURFACE)
style(ax)
y = list(range(len(ops)))[::-1]
left = [0] * len(ops)
for key, label, colour in CLASSES:
    vals = [tab[o][key] for o in ops]
    ax.barh(y, vals, left=left, height=0.6, color=colour, edgecolor=SURFACE, linewidth=1.5, label=label)
    left = [a + b for a, b in zip(left, vals)]
for yi, total in zip(y, left):
    ax.text(total + 4, yi, str(total), va="center", fontsize=8, color=INK2)
ax.set_yticks(y, ops, color=INK, fontsize=9)
ax.set_xlabel("mutants (corpus, base after each project's pipeline; default gate)", color=INK2, fontsize=9)
ax.set_title("What happens to each operator's mutants", color=INK, fontsize=10, loc="left")
ax.legend(frameon=False, fontsize=8, loc="lower right", labelcolor=INK)
fig.tight_layout()
fig.savefig(f"{out}/irwb005-classes-by-operator.png", facecolor=SURFACE)

# 3. kill rate (non-equivalent mutants) per operator, default vs version 2
def rate(op, g):
    k = sum(1 for r in records if r["operator"] == op and cls(r, g) == "killed")
    w = sum(1 for r in records if r["operator"] == op and cls(r, g) == "survived-wrong")
    return (k / (k + w) if k + w else None), k + w


fig, ax = plt.subplots(figsize=(7.2, 3.6), dpi=160)
fig.patch.set_facecolor(SURFACE)
style(ax)
y = list(range(len(ops)))[::-1]
for off, g, colour, label in ((0.17, "default", BLUE, "version 1, 40 cases"), (-0.17, "strong", ORANGE, "version 2")):
    vals = [rate(o, g) for o in ops]
    ax.barh([v + off for v in y], [100 * (x or 0) for x, _ in vals], height=0.32, color=colour, label=label)
for yi, o in zip(y, ops):
    (r1, n), (r2, _) = rate(o, "default"), rate(o, "strong")
    ax.text(101.5, yi, f"{100 * r1:.1f} → {100 * r2:.1f} %  (n = {n})" if r1 is not None else "n = 0", va="center", fontsize=8, color=INK2)
ax.set_xlim(0, 135)
ax.set_xticks([0, 25, 50, 75, 100])
ax.set_yticks(y, ops, color=INK, fontsize=9)
ax.set_xlabel("killed, % of non-equivalent mutants", color=INK2, fontsize=9)
ax.set_title("Kill rate per operator", color=INK, fontsize=10, loc="left")
ax.legend(frameon=False, fontsize=8, loc="lower left", labelcolor=INK)
fig.tight_layout()
fig.savefig(f"{out}/irwb005-kill-rate-by-operator.png", facecolor=SURFACE)
print("wrong accepted:", dict(zip([g for g, _ in GATES], counts)))
print("classes by operator:", {o: dict(tab[o]) for o in ops})
