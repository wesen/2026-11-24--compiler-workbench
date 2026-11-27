import json, re, sys, os

scores_path, docs_dir = sys.argv[1], sys.argv[2]
data = json.load(open(scores_path))
norm = lambda s: re.sub(r"\s+", "", s)
bad = 0
for d in data:
    text = norm(open(os.path.join(docs_dir, d["doc"])).read())
    c, s, q = d["counts"], d["scores"], d["quotes"]
    # every count > 0 and R7 yes and score < 5 must have quotes
    for k, v in c.items():
        need = (v == "yes") if k == "R7" else (v > 0)
        if need and not q.get(k):
            print("MISSING quote", d["doc"], k); bad += 1
        if k != "R7" and isinstance(v, int) and v > 0 and len(q.get(k, [])) < 1:
            pass
    for k, v in s.items():
        if v < 5 and not q.get(k):
            print("MISSING quote", d["doc"], k); bad += 1
    for k, lst in q.items():
        for x in lst:
            if norm(x) not in text:
                print("NOT FOUND", d["doc"], k, repr(x)); bad += 1
print("problems:", bad)
