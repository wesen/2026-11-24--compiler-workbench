// Constants all the way down: the walk-through. Run it on r0 (Scripts view)
// to see it from the start. fold and constprop feed each other: repeat
// until nothing changes
const rounds = [];
for (let i = 0; i < 4; i++) {
  const f = p.apply('fold');
  const c = p.apply('constprop');
  const s = p.apply('simplify');
  rounds.push([f.edits, c.edits, s.edits]);
  if (!f.edits && !c.edits && !s.edits) break;
}
p.apply('dce');
log(p.listing());
return { rounds, check: p.check().status };
