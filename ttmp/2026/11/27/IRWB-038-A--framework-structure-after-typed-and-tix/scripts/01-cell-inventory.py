#!/usr/bin/env python3
"""Inventory the reviewed cell HEADs and locate relevant code in committed blobs."""

import argparse
from pathlib import Path
import re
import subprocess

GROUPS = {
    "t6": ("033", "sm tl am op fa g-h ds-h ds-x gf-h g-max",
           "schedule|fusion|legal|executeSync|syncPassAlgorithm|dependence"),
    "d1": ("034", "sm am tl ds-x g-h op fa",
           "attribut|trace|counter|loops|back.edge|origin"),
    "a0": ("035", "sm am tl ds-x g-h op fa",
           "classif|audit|citedRule|structural|ruleMatch"),
    "b1": ("036", "sm am tl ds-x g-h op fa",
           "binding.time|specializ|residuali|StaticValue|abstract"),
}
# The T6 launch assigned A–J in the same order as the matrix below.
T6_ORDER = "sm am tl op fa g-h ds-h ds-x gf-h g-max"


def git(tree, *args):
    return subprocess.check_output(["git", "-C", str(tree), *args], text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("groups", nargs="*", choices=list(GROUPS))
    parser.add_argument("--anchors", action="store_true")
    args = parser.parse_args()
    siblings = Path(__file__).resolve().parents[7]
    for group in args.groups or GROUPS:
        number, ordered, pattern = GROUPS[group]
        if group == "t6":
            ordered = T6_ORDER
        for letter, agent in zip("abcdefghij", ordered.split()):
            tree = siblings / f"{group}-{agent}-irwb-{number}-{letter}"
            head = git(tree, "rev-parse", "--short", "HEAD").strip()
            diff = git(tree, "diff", "--name-only", "--diff-filter=ACMR", "t6-base", "HEAD")
            paths = diff.splitlines()
            ticket = f"/IRWB-{number}-{letter.upper()}--"
            docs = [p for p in paths if ticket in p and p.endswith(".md")
                    and not re.search(r"/(index|tasks|changelog)\.md$", p)]
            code = [p for p in paths if p.startswith(("src/", "tools/", "tests/"))]
            print(f"{tree.name} {head} code={len(code)} docs={len(docs)}")
            for name in [*code, *docs]:
                print(f"  {name}")
                if not args.anchors:
                    continue
                body = git(tree, "show", f"HEAD:{name}")
                selected = re.compile(
                    r"^#{1,3} .+" if name.endswith(".md") else
                    rf"^(export |function |  (async )?(legal|run|requires)\b).*({pattern})"
                    rf"|^.*\b(executeSync|syncPassAlgorithm|applyNativePassSync|planFusion|\.legal)\b",
                    flags=re.IGNORECASE,
                )
                for line, value in enumerate(body.splitlines(), 1):
                    if selected.search(value):
                        print(f"    {name}:{line} {value.strip()[:155]}")


if __name__ == "__main__":
    main()
