import json, re, sys, os

scores_path, docs_dir = sys.argv[1], sys.argv[2]

def norm(s):
    return re.sub(r"\s+", "", s)

scores = json.load(open(scores_path, encoding="utf-8"))
bad = 0
total = 0
for entry in scores:
    text = norm(open(os.path.join(docs_dir, entry["doc"]), encoding="utf-8").read())
    for k, v in entry.items():
        if k.endswith("_quotes"):
            base = k[:-len("_quotes")]
            val = entry[base]
            if isinstance(val, int) and val > 0 and not v:
                print(f"MISSING QUOTES {entry['doc']} {base}={val}")
                bad += 1
            if base == "R7" and not v:
                print(f"MISSING R7 QUOTE {entry['doc']}")
                bad += 1
            for q in v:
                total += 1
                if norm(q) not in text:
                    bad += 1
                    print(f"NOT FOUND {entry['doc']} {k}: {q!r}")
print(f"checked {total} quotes, {bad} problems")
sys.exit(1 if bad else 0)
