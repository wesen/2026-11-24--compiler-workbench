// Run checked speed and show the search step and attack-ray loop headers.
const run = p.pipeline('speed');
const search = p.fn('chessSearchStep');
const attacks = p.fn('chessAttacked');
return {
  revision: run.rev,
  changedPasses: run.steps
    .filter(step => step.changed)
    .map(({ pass, check }) => ({ pass, check })),
  rejectedPasses: run.steps.filter(step => step.rejected),
  entries: p.check({ count: 20 }).fns,
  searchStep: search.id,
  attackRays: attacks.loops().map(loop => loop.head),
};
