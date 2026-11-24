// What licm must not hoist: the walk-through. Run it on r0 (Scripts view)
// to see it from the start.
const r = p.apply('licm');
const div = p.fn('ratio').values().op('div').first();
return {
  licmEdits: r.edits,
  divIsPure: div.isPure,
  divHasEffect: div.hasEffect,
  check: p.check({ count: 200 }).status,
};
