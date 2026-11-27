# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Design committed; specialize-buffer, bta, frame-slots, copyprop, copyback implemented and tested; VM specialized to 79 and 79 instructions (general 7,678 and 6,874; hand-written 75 and 74), 96 code bytes

### Related Files

- src/typed/bta.ts — binding-time analysis
- src/typed/copyprop.ts — copyprop and copyback
- src/typed/frame-slots.ts — frame-slot promotion
- src/typed/specialize-buffer.ts — the specializer
- tests/typed/specialize-buffer.test.mjs — tests
