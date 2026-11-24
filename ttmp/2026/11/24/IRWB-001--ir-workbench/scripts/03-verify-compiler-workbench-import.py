#!/usr/bin/env python3
"""Check that sources/compiler-workbench-projects/ loses nothing from 'Compiler Workbench_ projects.zip'.

The zip ships only the built site. Its authored sources (book chapters, API reference,
44 projects, tests) exist inside the generated bundles app/content/*.js and app/sources.js.
The import unpacks them into the original repo layout (src/, site/, test/) and drops the
bundles. This script reads the zip directly and verifies, data-for-data:

  * every non-generated site file in the zip is byte-identical in site/
  * WB_SOURCES (app/sources.js): every entry equals the imported file it names
    (index.html differs from the shipped one only in its <title>, which is reported)
  * WB_PROJECTS (app/content/projects.js): same ids, order and file contents as src/projects/
  * WB_BOOK (app/content/book.js): chapter md and id/title equal src/book/*.md
  * WB_REFERENCE (app/content/reference.js): equals src/reference.md

Usage:
    python3 -I 03-verify-compiler-workbench-import.py "<zip>" <imported-dir>
"""
import json
import os
import re
import sys
import zipfile

GENERATED = {"app/sources.js", "app/content/book.js", "app/content/reference.js", "app/content/projects.js"}


def payload(text, name, opener):
    start = text.index(opener, text.index(name))
    return json.JSONDecoder().raw_decode(text[start:])[0]


def read(root, rel):
    with open(os.path.join(root, rel), "rb") as fh:
        return fh.read()


def main(zip_path, root):
    problems, notes = [], []
    zf = zipfile.ZipFile(zip_path)
    site = os.path.join(root, "site")

    shipped = [n for n in zf.namelist() if not n.endswith("/")]
    for n in shipped:
        if n in GENERATED:
            continue
        if not os.path.exists(os.path.join(site, n)):
            problems.append(f"site file missing: {n}")
        elif read(site, n) != zf.read(n):
            problems.append(f"site file differs: {n}")

    sources = payload(zf.read("app/sources.js").decode("utf-8"), "WB_SOURCES", "{")
    for rel, body in sources.items():
        base = root if rel.startswith(("src/", "test/")) else site
        path = os.path.join(base, rel)
        if not os.path.exists(path):
            problems.append(f"embedded source missing: {rel}")
            continue
        if read(base, rel) != body.encode("utf-8"):
            if rel == "index.html":
                notes.append("index.html: embedded copy differs from shipped copy (title only expected)")
            else:
                problems.append(f"embedded source differs: {rel}")

    projects = payload(zf.read("app/content/projects.js").decode("utf-8"), "WB_PROJECTS", "[")
    pdir = os.path.join(root, "src", "projects")
    order = json.loads(read(pdir, "index.json"))["order"]
    if order != [p["id"] for p in projects]:
        problems.append("src/projects/index.json order differs from WB_PROJECTS")
    for p in projects:
        on_disk = {}
        for dirpath, _, files in os.walk(os.path.join(pdir, p["id"])):
            for f in files:
                full = os.path.join(dirpath, f)
                on_disk[os.path.relpath(full, os.path.join(pdir, p["id"])).replace(os.sep, "/")] = open(full, encoding="utf-8", newline="").read()
        if on_disk != p["files"]:
            problems.append(f"project differs: {p['id']}")

    book = payload(zf.read("app/content/book.js").decode("utf-8"), "WB_BOOK", "[")
    chapters = sorted(f for f in os.listdir(os.path.join(root, "src", "book")) if f.endswith(".md"))
    if len(chapters) != len(book):
        problems.append(f"book chapters: {len(chapters)} files vs {len(book)} in WB_BOOK")
    for f, entry in zip(chapters, book):
        text = read(os.path.join(root, "src", "book"), f).decode("utf-8")
        m = re.match(r"^---\n([\s\S]*?)\n---\n", text)
        meta = dict((k.strip(), v.strip()) for k, v in (line.split(":", 1) for line in m.group(1).split("\n")))
        if text[m.end():] != entry["md"] or meta.get("id") != entry["id"] or meta.get("title") != entry["title"]:
            problems.append(f"chapter differs: {f}")

    reference = payload(zf.read("app/content/reference.js").decode("utf-8"), "WB_REFERENCE", '"')
    if read(root, "src/reference.md").decode("utf-8") != reference:
        problems.append("src/reference.md differs from WB_REFERENCE")

    print(f"zip files: {len(shipped)} ({len(GENERATED)} generated bundles not imported)")
    print(f"embedded sources: {len(sources)}  projects: {len(projects)}  chapters: {len(book)}")
    for n in notes:
        print("note:", n)
    for p in problems:
        print("PROBLEM:", p)
    print("round trip OK" if not problems else f"{len(problems)} problems")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
