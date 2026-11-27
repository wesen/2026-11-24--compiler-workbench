# Tasks

## TODO
- [x] Read the framework machinery the design must fit (applyPass, differential/DifferentialSpec, typed/rules verify+form, typed/f32) <!-- t:2w3a -->
- [x] Settle the rule set (Split, Factor, Fuse, Rebase) and the two-set lemma argument <!-- t:rrl0 -->
- [x] Probe the algebra exactly (rationals + multiplicative exp surrogate) and the per-stage f32 drift <!-- t:dxlv -->
- [x] Write the design document (rules, fold extension, checking, generality, experiment) <!-- t:x6wi -->
- [ ] Diary, ticket bookkeeping and commit <!-- t:d3y0 -->
- [ ] Follow-up (design section 11): implement the fold (type checker, extent inference, region scoping) on top of the Tix front end <!-- t:au3d -->
- [ ] Follow-up: tensor-rule form and verifier (the analogue of src/typed/rules for statements) <!-- t:eb94 -->
- [ ] Follow-up: reconcile the design's tolerance relation (section 6.1, per-element sigma scale) with the parallel Tix meaning contract <!-- t:sb3a -->
- [ ] Follow-up: run the experiment on the GB10 (arms a-f, record compute_cap, ncu DRAM bytes, median times) <!-- t:44o2 -->
- [ ] Follow-up: check the mean/variance monoid instance (layernorm) that the design marks as claimed, not checked <!-- t:i42f -->
