import json, re, sys, os
base = sys.argv[1]
data = json.load(open(os.path.join(base, 'scores.json'), encoding='utf-8'))
norm = lambda s: re.sub(r'\s+', ' ', s).strip()
bad = 0; total = 0
for d in data:
    text = norm(open(os.path.join(base, 'docs', d['doc']), encoding='utf-8').read())
    c, s, q = d['counts'], d['scores'], d['quotes']
    # every nonzero count / R7 yes / score<5 has quotes, and quotes only for those
    for k, v in c.items():
        need = (v == 'yes') if k == 'R7' else (v > 0)
        if need and not q.get(k): print('MISSING QUOTE', d['doc'], k); bad += 1
        if k != 'R7' and isinstance(v, int) and v > 0 and len(q.get(k, [])) < v and k not in ('R4','R5','R3','R1','R8'):
            pass
    for k, v in s.items():
        if v < 5 and not q.get(k): print('MISSING QUOTE', d['doc'], k); bad += 1
    for k, lst in q.items():
        for x in lst:
            total += 1
            if norm(x) not in text:
                print('NOT FOUND', d['doc'], k, repr(x[:90])); bad += 1
print('docs', len(data), 'quotes', total, 'problems', bad)
