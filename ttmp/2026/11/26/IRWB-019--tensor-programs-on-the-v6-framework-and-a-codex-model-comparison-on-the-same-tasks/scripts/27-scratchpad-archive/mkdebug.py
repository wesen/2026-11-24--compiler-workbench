import sys
src, dst = sys.argv[1], sys.argv[2]
s=open(src).read()
s=s.replace("const root = new URL('../../../../../../', import.meta.url).pathname;","const root = '/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/agent-a835ea9e40615941e/';")
s=s.replace("let cls = new Uint8Array(cap), fnr","let vix = new Int32Array(cap); let cls = new Uint8Array(cap), fnr")
s=s.replace("cls = g(cls, Uint8Array);","vix = g(vix, Int32Array); cls = g(cls, Uint8Array);")
s=s.replace("d0[n] = a; d1[n] = b;","vix[n] = CURV; d0[n] = a; d1[n] = b;")
s=s.replace("const s = st.get(sid);\n          switch (s.op) {","const s = st.get(sid); CURV = vidOf(sid);\n          switch (s.op) {")
s=s.replace("const C = 0, KT = 1","const VIDS = new Map(), VNAMES = []; let CURV = -1; const vidOf = id => { let x = VIDS.get(id); if (x === undefined) { x = VNAMES.length; VIDS.set(id, x); VNAMES.push(id); } return x; };\nconst DETAIL = new Map();\nconst C = 0, KT = 1")
s=s.replace("""      if (cls[i] === PHI) { if (live[i]) prof.livePhis++; continue; }""","""      if (cls[i] === PHI) { if (live[i]) prof.livePhis++; continue; }
      if (fnNames[fnr[i]] === process.env.DETAIL) { const k2 = VNAMES[vix[i]]; const e = DETAIL.get(k2) ?? [0, 0]; e[live[i] ? 0 : 1]++; DETAIL.set(k2, e); }""")
s=s.replace("const out = JSON.stringify(results, null, 1);","""const rows = [...DETAIL].sort((a, b) => b[1][1] - a[1][1]).slice(0, 20);
for (const [id, [l, d]] of rows) console.error(id, 'live', l, 'dead', d, st.get(id)?.op);
const out = JSON.stringify(results, null, 1);""")
open(dst,'w').write(s)
