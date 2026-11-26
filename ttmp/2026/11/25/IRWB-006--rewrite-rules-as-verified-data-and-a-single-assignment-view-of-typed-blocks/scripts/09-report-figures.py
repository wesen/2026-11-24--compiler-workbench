# Figures for the IRWB-006 vault report, from the recorded measurements in ../various/.
#   python3 -I scripts/09-report-figures.py <out-dir>
# Writes irwb006-evidence-strength.png, irwb006-ssa-candela.png, irwb006-sccp-constants.png.
import json, os, statistics, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

here = os.path.dirname(os.path.abspath(__file__))
various = os.path.join(here, "..", "various")
out = sys.argv[1] if len(sys.argv) > 1 else various
os.makedirs(out, exist_ok=True)

SURFACE, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]
plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "text.color": INK, "font.size": 10, "axes.spines.top": False, "axes.spines.right": False,
})

def load(name):
    with open(os.path.join(various, name)) as f:
        return json.load(f)

# 1. evidence strength per rule set
ev = load("08-rule-evidence.json")["evidence"]
order = ["proof", "exhaustive", "reduced-width+argument", "by-construction"]
labels = {"proof": "proof", "exhaustive": "exhaustive", "reduced-width+argument": "8 bits + argument",
          "by-construction": "by the evaluator"}
rows = [("simplify (27)", ev["simplify"]), ("fold (40)", ev["fold"])]
fig, ax = plt.subplots(figsize=(7.2, 2.6))
for y, (name, recs) in enumerate(rows):
    left = 0
    for i, s in enumerate(order):
        n = sum(1 for r in recs.values() if r.get("strength") == s)
        if not n:
            continue
        ax.barh(y, n, left=left, color=SERIES[i], height=0.5, edgecolor=SURFACE, linewidth=2)
        ax.text(left + n / 2, y, str(n), ha="center", va="center", color="#ffffff" if i in (0, 1) else INK, fontsize=9)
        left += n
unsound = ev["unsound-candidates"]
ax.barh(2, len(unsound), color="#e34948", height=0.5, edgecolor=SURFACE, linewidth=2)
ax.text(len(unsound) / 2, 2, str(sum(1 for r in unsound.values() if r["verdict"] == "unsound")), ha="center", va="center", color="#ffffff", fontsize=9)
ax.set_yticks([0, 1, 2], [rows[0][0], rows[1][0], "unsound candidates (7)"])
ax.invert_yaxis()
ax.set_xlabel("rules")
ax.grid(axis="x", color=GRID, linewidth=0.8)
ax.set_axisbelow(True)
handles = [plt.Rectangle((0, 0), 1, 1, color=SERIES[i]) for i in range(len(order))] + [plt.Rectangle((0, 0), 1, 1, color="#e34948")]
ax.legend(handles, [labels[s] for s in order] + ["rejected"], ncol=5, frameon=False, fontsize=8,
          loc="upper center", bbox_to_anchor=(0.45, 1.28))
fig.tight_layout()
fig.savefig(os.path.join(out, "irwb006-evidence-strength.png"), dpi=160)
plt.close(fig)

# 2. SSA against reaching definitions on Candela r0: time and size, two panels, one measure each
c = load("10-ssa-check-candela.json")
t_reach, t_ssa = statistics.median(c["ms"]["reaching"]) / 1000, statistics.median(c["ms"]["ssa"]) / 1000
b_reach, b_ssa = c["bytes"]["reaching"] / 1e6, c["bytes"]["ssa"] / 1e6
fig, axes = plt.subplots(1, 2, figsize=(7.2, 2.6))
for ax, (title, vals, unit) in zip(axes, [("time to compute, median of 3 (s)", (t_reach, t_ssa), "s"),
                                          ("fact size as JSON (MB)", (b_reach, b_ssa), "MB")]):
    ax.bar([0, 1], vals, color=[SERIES[0], SERIES[2]], width=0.55, edgecolor=SURFACE, linewidth=2)
    for x, v in enumerate(vals):
        ax.text(x, v, f"{v:.2f} {unit}" if unit == "s" else f"{v:.1f} {unit}", ha="center", va="bottom", fontsize=9)
    ax.set_xticks([0, 1], ["typed.reaching", "typed.ssa"])
    ax.set_title(title, fontsize=9, color=INK2)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.set_ylim(0, max(vals) * 1.2)
fig.suptitle("Candela r0: 332 functions, 14,598 reads, 0 disagreements", fontsize=10)
fig.tight_layout()
fig.savefig(os.path.join(out, "irwb006-ssa-candela.png"), dpi=160)
plt.close(fig)

# 3. SCCP: the constants project's instructions per pipeline
s = load("11-sccp-corpus.json")
row = next(r for r in s["rows"] if r["id"] == "constants")
names = ["O2", "O2-sccp", "O2+", "O2x2"]
shown = ["O2", "O2-sccp", "O2+", "O2 twice"]
vals = [row[n]["instructions"] for n in names]
fig, ax = plt.subplots(figsize=(7.2, 2.4))
ax.bar(range(4), vals, color=SERIES[0], width=0.55, edgecolor=SURFACE, linewidth=2)
for x, v in enumerate(vals):
    ax.text(x, v, str(v), ha="center", va="bottom", fontsize=9)
ax.set_xticks(range(4), shown)
ax.set_ylabel("instructions (10 cases)")
ax.set_ylim(0, max(vals) * 1.25)
ax.grid(axis="y", color=GRID, linewidth=0.8)
ax.set_axisbelow(True)
ax.set_title("corpus project constants: emulator instructions per pipeline", fontsize=9, color=INK2)
fig.tight_layout()
fig.savefig(os.path.join(out, "irwb006-sccp-constants.png"), dpi=160)
plt.close(fig)
print("wrote", out)
