// Compare the default RV32 backend at r0 and after the checked speed pipeline.
const input = ['[a-c]*[b-d]*a*d', 'abccabbd'];
const before = p.compile({ rev: 'r0' }).run('regexMatch', input);
const { steps } = p.pipeline('speed');
const after = p.compile().run('regexMatch', input);
return {
  r0: { result: before.result, instructions: before.steps, trap: before.trap },
  speed: { result: after.result, instructions: after.steps, trap: after.trap },
  rejected: steps.filter(step => step.rejected).map(step => step.pass),
};
