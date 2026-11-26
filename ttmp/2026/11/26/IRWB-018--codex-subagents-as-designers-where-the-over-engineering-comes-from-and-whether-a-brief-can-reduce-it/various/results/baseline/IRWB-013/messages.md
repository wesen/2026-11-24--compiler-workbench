## 1

I’ll use the docmgr and diary skills, then check the corpus, Typed frontend, and verification code before drafting and committing the IRWB-013 design.

## 2

The design will use one corpus project with two entry points. SHA-256 will keep its round constants in a separate input buffer for specialization experiments, and ChaCha20 will keep its sixteen working words in scalar locals to expose register pressure. I’ve also confirmed that the pass checker counts executed IR statements. Both kernels will have a measured step-budget gate before they enter the corpus.

## 3

The draft now defines the SHA padding boundary, the ChaCha state layout, and how the benchmark counts instructions per byte. I also checked the proposed Typed features with a small vendor compiler probe. The step estimates still need to be measured once the kernels are implemented.

## 4

- [Design document](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-013/ttmp/2026/11/26/IRWB-013--sha-256-and-chacha20/design-doc/01-sha-256-and-chacha20-corpus-project.md)
- [IRWB-013 ticket](/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/codex-irwb-013/ttmp/2026/11/26/IRWB-013--sha-256-and-chacha20/index.md)
- Commit `a493a0b67dd6727343ad324ae837e53215f5255b`

The design specifies one Typed corpus project with SHA-256 inputs up to 119 bytes and a ChaCha20 block function that keeps all 16 working words in scalar locals. It defines the buffer layouts, specialization inputs, generated cases, bit-exact oracle checks, and RV32 instructions-per-byte measurements. The evaluator step budgets are estimates to verify during implementation. The ticket passed `docmgr doctor`, and the commit contains only ticket files.
