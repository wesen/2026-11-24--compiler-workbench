import json, re, sys, os
d = sys.argv[1]
scores = json.load(open(os.path.join(d, "scores.json"), encoding="utf-8"))
def norm(s): return re.sub(r"\s+", " ", s).strip()
bad = 0
keys = ["R%d" % i for i in range(1, 10)]
for s in scores:
    text = norm(open(os.path.join(d, "docs", s["doc"]), encoding="utf-8").read())
    for k in keys:
        for q in s.get(k + "_quotes", []):
            q2 = re.sub(r"^\[[^\]]*\]\s*", "", q)
            if norm(q2) not in text:
                bad += 1
                print("MISSING", s["doc"], k, repr(q2[:90]))
    for k in keys + ["A1","A2","A3","A4","over_engineering","fitness","justification","program"]:
        if k not in s: print("NOKEY", s["doc"], k); bad += 1
print("docs:", len(scores), "missing quotes:", bad)
