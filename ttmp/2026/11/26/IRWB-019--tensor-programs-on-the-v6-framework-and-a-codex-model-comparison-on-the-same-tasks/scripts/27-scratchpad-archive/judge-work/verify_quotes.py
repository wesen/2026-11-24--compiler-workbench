import json, re, sys, os
base = sys.argv[1]
data = json.load(open(os.path.join(base, "scores.json"), encoding="utf-8"))
norm = lambda s: re.sub(r"\s+", "", s)
bad = 0; total = 0
for d in data:
    text = norm(open(os.path.join(base, "docs", d["doc"]), encoding="utf-8").read())
    qs = [("err", e["quote"]) for e in d["errors"]]
    for k, lst in d["quotes"].items():
        qs += [(k, q) for q in lst]
    for k, q in qs:
        total += 1
        if norm(q) not in text:
            bad += 1
            print("MISSING", d["doc"], k, repr(q))
    # sanity: every score below 5 has a quote
    for k, v in d["scores"].items():
        if v < 5 and not d["quotes"].get(k):
            print("NOQUOTE", d["doc"], k)
print(f"{total} quotes checked, {bad} missing")
