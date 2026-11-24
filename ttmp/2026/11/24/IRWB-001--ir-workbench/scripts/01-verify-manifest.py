#!/usr/bin/env python3
"""Verify IR Source Workbench v6 files against the release's WORKSPACE-MANIFEST.json.

Two modes:

  zip mode   - argument is the original ir-source-workbench-v6-complete.zip.
               Checks zip CRCs, that every manifest entry exists with the stated
               byte count and SHA-256, and that the archive has no unlisted files.

  tree mode  - argument is the imported subset in sources/ir-source-workbench-v6/.
               Checks that every file present matches its manifest entry, and
               summarizes which manifest entries were intentionally not imported.

Usage (run with -I so nothing is imported from the current directory):
    python3 -I 01-verify-manifest.py ~/Downloads/ir-source-workbench-v6-complete.zip
    python3 -I 01-verify-manifest.py ../sources/ir-source-workbench-v6
"""
import collections
import hashlib
import json
import os
import sys
import zipfile

PREFIX = "ir-source-workbench/"
MANIFEST = "WORKSPACE-MANIFEST.json"


def report(manifest, checked, missing, size_bad, hash_bad, extra):
    print(f"release={manifest.get('release')} package={manifest.get('packageVersion')} createdAt={manifest.get('createdAt')}")
    print(f"manifest entries: {len(manifest['files'])}  files checked: {checked}")
    print(f"missing: {len(missing)}  size mismatches: {len(size_bad)}  hash mismatches: {len(hash_bad)}  unlisted: {len(extra)}")
    for label, items in (("missing", missing), ("size", size_bad), ("hash", hash_bad), ("unlisted", extra)):
        for item in items[:20]:
            print(f"  {label}: {item}")
    return 0 if not (missing or size_bad or hash_bad or extra) else 1


def check(entries, read):
    size_bad, hash_bad = [], []
    for e in entries:
        data = read(e["path"])
        if len(data) != e["bytes"]:
            size_bad.append(e["path"])
        if hashlib.sha256(data).hexdigest() != e["sha256"]:
            hash_bad.append(e["path"])
    return size_bad, hash_bad


def verify_zip(path):
    with zipfile.ZipFile(path) as zf:
        bad = zf.testzip()
        if bad is not None:
            print(f"CRC failure: {bad}")
            return 1
        names = {n[len(PREFIX):] for n in zf.namelist() if n.startswith(PREFIX) and not n.endswith("/")}
        manifest = json.loads(zf.read(PREFIX + MANIFEST))
        entries = manifest["files"]
        missing = [e["path"] for e in entries if e["path"] not in names]
        present = [e for e in entries if e["path"] in names]
        size_bad, hash_bad = check(present, lambda p: zf.read(PREFIX + p))
        extra = sorted(names - {e["path"] for e in entries} - {MANIFEST})
    return report(manifest, len(present), missing, size_bad, hash_bad, extra)


def verify_tree(root):
    with open(os.path.join(root, MANIFEST), "rb") as fh:
        manifest = json.load(fh)
    by_path = {e["path"]: e for e in manifest["files"]}
    present = []
    for dirpath, _, files in os.walk(root):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), root).replace(os.sep, "/")
            if rel != MANIFEST:
                present.append(rel)
    extra = sorted(p for p in present if p not in by_path)
    listed = [by_path[p] for p in sorted(present) if p in by_path]

    def read(p):
        with open(os.path.join(root, p), "rb") as fh:
            return fh.read()

    size_bad, hash_bad = check(listed, read)
    imported = set(present)
    skipped = collections.Counter(
        (e["path"].split("/")[0] if "/" in e["path"] else "(top-level)")
        for e in manifest["files"] if e["path"] not in imported
    )
    print("not imported (by top-level path): " + ", ".join(f"{k}={v}" for k, v in sorted(skipped.items())))
    # Missing is not an error in tree mode: the subset is intentional.
    return report(manifest, len(listed), [], size_bad, hash_bad, extra)


if __name__ == "__main__":
    target = sys.argv[1]
    sys.exit(verify_tree(target) if os.path.isdir(target) else verify_zip(target))
