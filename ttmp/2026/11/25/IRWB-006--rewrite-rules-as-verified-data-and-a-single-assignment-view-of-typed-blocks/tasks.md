# Tasks

## TODO
- [x] Read IRWB-002 guide, simplify/fold, Tx, analyses, framework rule engine; record corpus revision baseline <!-- t:mwkk -->
- [x] Write the intern guide (design-doc 01), second pass, relate files <!-- t:eifc -->
- [x] Upload the guide to reMarkable (/ai/2026/11/25/IRWB-006) and verify <!-- t:cc64 -->
- [x] B1: rule form, rule compiler to a Tx visitor, simplify as a rule table; corpus equivalence (every pipeline, every revision) <!-- t:m8a6 -->
- [x] B1: fold as a rule table (if practical); corpus equivalence <!-- t:gm35 -->
- [x] B1: Candela O2 equivalence; switch simplify (and fold) to the table only if every revision is identical <!-- t:jnlu -->
- [x] B1: evaluate the framework rule engine (pattern cross-check, cost) and record the decision <!-- t:qkls -->
- [x] B2: width-parametric semantics and rule verifier (symbolic-linear, bitwise width-1, exhaustive reduced width, exhaustive 32, boundary+random 32, f32 edges) <!-- t:b3rw -->
- [ ] B2: record each rule's evidence; test that rejects deliberately unsound rules <!-- t:72km -->
- [x] A1: SSA analysis typed.ssa (dominator tree, dominance frontiers, phi placement, renaming, name->stmt/value mapping) <!-- t:3y8d -->
- [x] A1: validate SSA def-use against reaching definitions on every corpus function and Candela r0; time ssa vs reaching <!-- t:85ra -->
- [x] A1/A2: SCCP prototype on SSA in a new pipeline, measured against constprop on the corpus <!-- t:ob4k -->
- [ ] Workbench: rules listing at 72 columns <!-- t:hxt4 -->
- [ ] Frozen gates: npm test, IRWB_FULL passes/backend, parity, corpus revisions identical to baseline <!-- t:86m6 -->
- [ ] Vault report (deep dive), checked against the diary <!-- t:v34a -->
