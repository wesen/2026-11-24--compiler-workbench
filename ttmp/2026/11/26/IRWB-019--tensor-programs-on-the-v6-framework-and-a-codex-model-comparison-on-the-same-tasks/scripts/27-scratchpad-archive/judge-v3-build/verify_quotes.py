import json, re, sys, os

scores_path, docs_dir = sys.argv[1], sys.argv[2]
data = json.load(open(scores_path))
ws = re.compile(r"\s+")
bad = 0
total = 0
for d in data:
    text = ws.sub("", open(os.path.join(docs_dir, d["doc"]), encoding="utf-8").read())
    # every count > 0 and every score < 5 must have a quote
    for k, v in d["counts"].items():
        if (isinstance(v, int) and v > 0) or v == "yes":
            if not d["quotes"].get(k):
                print("MISSING quote", d["doc"], k); bad += 1
            elif isinstance(v, int) and len(d["quotes"][k]) < v:
                print("FEWER quotes than count", d["doc"], k, v, len(d["quotes"][k])); bad += 1
    for k, v in d["scores"].items():
        if v < 5 and not d["quotes"].get(k):
            print("MISSING quote", d["doc"], k); bad += 1
    for k, qs in d["quotes"].items():
        for q in qs:
            total += 1
            if ws.sub("", q) not in text:
                print("NOT FOUND", d["doc"], k, repr(q)); bad += 1
print(f"checked {total} quotes; problems: {bad}")
