#!/usr/bin/env python3
"""Check the review's full line anchors against the merged tree and cited cell snapshots."""

from functools import lru_cache
from pathlib import Path
import re
import subprocess


MATRIX_ROW = re.compile(r"\| ([A-J]) · ((?:t6|d1|a0|b1)-[^| ]+) \| `([a-f0-9]+)`")
ANCHOR = re.compile(
    r"`(?:(T6-[A-J]|D1-[A-G]|A0-[A-G]|B1-[A-G])/)?"
    r"((?:(?:src|tests|ttmp)/[^ :`]+)|BACKLOG\.md):(\d+)`"
)
LINK = re.compile(r"\]\(([^)]+)\)")


def main():
    ticket = Path(__file__).resolve().parents[1]
    root = ticket.parents[4]
    annex = ticket / "analysis/01-cell-evidence.md"
    lookup = {
        tree[:2].upper() + "-" + cell: (root.parent / tree, head)
        for cell, tree, head in MATRIX_ROW.findall(annex.read_text())
    }
    if len(lookup) != 31:
        raise SystemExit(f"expected 31 cell rows, found {len(lookup)}")

    @lru_cache(None)
    def line_count(path, cell):
        if not cell:
            return len((root / path).read_text().splitlines())
        tree, head = lookup[cell]
        content = subprocess.check_output(
            ["git", "-C", str(tree), "show", f"{head}:{path}"], text=True
        )
        return len(content.splitlines())

    count = 0
    errors = []
    for document in [ticket / "index.md", *ticket.glob("design-doc/*.md"), annex]:
        for row in document.read_text().splitlines():
            matrix = MATRIX_ROW.search(row)
            row_cell = matrix[2][:2].upper() + "-" + matrix[1] if matrix else ""
            for cell, path, lineno in ANCHOR.findall(row):
                cell = cell or row_cell
                try:
                    if not 0 < int(lineno) <= line_count(path, cell):
                        raise ValueError("line outside file")
                    count += 1
                except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
                    errors.append(f"{document.name}: {cell}/{path}:{lineno}: {error}")
            for href in LINK.findall(row):
                if href.startswith(("http:", "https:", "#")):
                    continue
                if not (document.parent / href.split("#")[0]).is_file():
                    errors.append(f"{document.name}: broken link {href}")
    if errors:
        raise SystemExit("\n".join(errors))
    print(f"{count} full line anchors and local document links resolve across {len(lookup)} frozen heads")


if __name__ == "__main__":
    main()
