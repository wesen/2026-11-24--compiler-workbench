---
Title: Missed Typed optimizations from instruction provenance
Ticket: IRWB-037-A
Status: complete
Topics:
    - compiler
    - performance
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: Provenance-guided bounds elimination and a verified low-bit hash rewrite
LastUpdated: 2026-11-27T13:01:52.511596178-05:00
WhatFor: ""
WhenToUse: ""
---

# Missed Typed optimizations from instruction provenance

## Overview

Instruction attribution identified redundant fixed bounds in the Thompson regex matcher and LZ compressor. The checked Typed pipeline now eliminates those checks and simplifies the measured LZ hash with a verified rule.

- [Design](design-doc/01-find-missed-optimizations-from-hot-rv32-code.md)
- [Report and corpus measurements](reference/02-measurements-and-results.md)
- [Implementation diary](reference/01-implementation-diary.md)
- [Tasks](tasks.md)
- [Changelog](changelog.md)
