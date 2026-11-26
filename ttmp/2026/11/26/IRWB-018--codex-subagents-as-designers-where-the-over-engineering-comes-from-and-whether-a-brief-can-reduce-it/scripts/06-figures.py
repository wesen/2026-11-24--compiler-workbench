#!/usr/bin/env python3
"""IRWB-018 figures for the vault report.

Usage: python3 06-figures.py <results-dir> <scores.json> <out-dir>
  irwb018-rounds.png         words, judge over-engineering and judge fitness per program and round (small multiples)
  irwb018-style-markers.png  contrast markers and semicolons per 1,000 prose words, Codex docs against Claude guides
Palette: the dataviz reference categorical slots 1-3 (validated: CVD worst adjacent dE 12.6); values are also tabled
in the report, which covers the contrast warning for orange and aqua on white.
"""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

results, scores_path, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
ROUNDS = ["baseline", "round2", "round3"]
LABELS = {"baseline": "Baseline brief", "round2": "Round 2: revised brief", "round3": "Round 3: self-review"}
COLORS = {"baseline": "#257de0", "round2": "#f47230", "round3": "#00b894"}
PROGRAMS = ["IRWB-012", "IRWB-013", "IRWB-014", "IRWB-015", "IRWB-016", "IRWB-017"]
SHORT = {"IRWB-012": "VM", "IRWB-013": "SHA/ChaCha", "IRWB-014": "LZ", "IRWB-015": "Regex", "IRWB-016": "DSP", "IRWB-017": "Chess"}
TEXT, TEXT2, GRID = "#191919", "#666666", "#e6e6e6"

key = json.loads((results / "blind-key.json").read_text())
scores = {s["doc"]: s for s in json.loads(scores_path.read_text())}
cell = {}
for k in key:
    s = scores.get(k["name"], {})
    cell[(k["id"], k["round"])] = {"words": k["words"], "over": s.get("over_engineering"), "fit": s.get("fitness")}

def style(ax, title, ymax):
    ax.set_title(title, loc="left", color=TEXT, fontsize=11)
    ax.set_ylim(0, ymax)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)
    ax.tick_params(colors=TEXT2, labelsize=9)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)

fig, axes = plt.subplots(1, 3, figsize=(13, 4.2), dpi=150)
panels = [("words", "Words in the design doc", 4500), ("over", "Judge: over-engineering (0-10)", 10), ("fit", "Judge: fitness for purpose (0-10)", 10)]
width = 0.26
for ax, (field, title, ymax) in zip(axes, panels):
    for i, r in enumerate(ROUNDS):
        xs = [j + (i - 1) * (width + 0.02) for j in range(len(PROGRAMS))]
        ys = [cell.get((p, r), {}).get(field) or 0 for p in PROGRAMS]
        ax.bar(xs, ys, width=width, color=COLORS[r], label=LABELS[r], edgecolor="white", linewidth=1.5)
    ax.set_xticks(range(len(PROGRAMS)))
    ax.set_xticklabels([SHORT[p] for p in PROGRAMS], fontsize=9)
    style(ax, title, ymax)
handles, labels = axes[0].get_legend_handles_labels()
fig.legend(handles, labels, loc="upper center", ncol=3, frameon=False, fontsize=10, labelcolor=TEXT, bbox_to_anchor=(0.5, 1.02))
fig.tight_layout(rect=(0, 0, 1, 0.93))
fig.savefig(out / "irwb018-rounds.png", facecolor="white")

# Style markers: Codex baseline docs against the Claude-written guides, per 1,000 prose words.
base = json.loads((results / "baseline" / "content-metrics.json").read_text())
codex = [r for r in base if not r["label"].startswith("claude-")]
claude = [r for r in base if r["label"].startswith("claude-")]
fig, axes = plt.subplots(1, 2, figsize=(9, 3.4), dpi=150)
for ax, (field, title) in zip(axes, [("contrastPer1k", "Contrast markers per 1,000 words"), ("semicolonsPer1k", "Semicolons per 1,000 words")]):
    for row, (group, rows, color) in enumerate([("Codex design docs (6)", codex, "#257de0"), ("Claude-written guides (5)", claude, "#f47230")]):
        vals = [r[field] for r in rows]
        ax.scatter(vals, [row] * len(vals), s=64, color=color, edgecolor="white", linewidth=2, zorder=3)
    ax.set_yticks([0, 1])
    ax.set_yticklabels(["Codex design docs (6)", "Claude-written guides (5)"], fontsize=9, color=TEXT)
    ax.set_ylim(-0.6, 1.6)
    ax.set_xlim(left=0)
    ax.set_title(title, loc="left", color=TEXT, fontsize=11)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=TEXT2, labelsize=9)
    ax.xaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
fig.tight_layout()
fig.savefig(out / "irwb018-style-markers.png", facecolor="white")
print("wrote", out / "irwb018-rounds.png", out / "irwb018-style-markers.png")
