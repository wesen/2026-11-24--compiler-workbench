# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

D1: cause found from the compiler's records (licm hoists the opcode arms' frame addresses into preheaders that run on every dispatch: 15 hoists, 172-184 executions each against 12-97 for the statements they replace); attribution tool src/typed/attribution.ts + tools/attribution.mjs with 4 tests; licm cost check (single back edge + latch dominance, lazy preheader, skip records); bytecode VM speed 9,286/8,218 -> 6,688/5,968 at n=12 seed=8; corpus O2 -2.5%%, speed -2.0%%; parity and reference-check clean

### Related Files

- src/typed/attribution.ts — the attribution tool (new)
- src/typed/passes.ts — the licm cost check
- tests/typed/attribution.test.mjs — tests for the tool
- tools/attribution.mjs — CLI over the tool
