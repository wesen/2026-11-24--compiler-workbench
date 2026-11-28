---
Title: One coverage check
Ticket: IRWB-063
Status: active
Topics: [framework, compiler]
DocType: design-doc
---

# One coverage check

The supported inputs are correspondence entity lists and entries with source and target string arrays, under the five existing coverage policies. Check mapped entries before derivation completion for nonempty; check the completed correspondence for source and target, preserving the current distinction. Contract correspondences have no completion, so use their declared entries for both.

Put the policy and a single checker in the IR correspondence module. The simpler alternative, keeping two independent checks, permits drift. Return a descriptive failure to let each caller retain its existing error type and wording. A minimal type-only reference from contracts/types.ts is required to remove the duplicate type; the brief's narrower scope excludes that file, while the intern guide includes it. Pending clarification, implement the checker and callers first.

No additional framework machinery is needed. Later: none.
