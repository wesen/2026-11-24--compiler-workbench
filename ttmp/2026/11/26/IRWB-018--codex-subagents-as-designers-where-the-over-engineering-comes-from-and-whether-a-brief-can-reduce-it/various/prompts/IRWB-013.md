## Your program — ticket IRWB-013: SHA-256 and ChaCha20
Pure 32-bit integer cryptography in Typed: SHA-256 (64 rounds, message schedule) and the ChaCha20 block function (16 live state words).
- Why: RV32's base ISA has no rotate instruction, so `(x >>> n) | (x << (32 - n))` idioms are targets for rule discovery (IRWB-010); round unrolling and constant tables exercise constant propagation; 16+ live values stress register allocation.
- Oracle: published test vectors, and the framework's own SHA-256 (`src/framework/core/data.ts`) as a second implementation.
- Measure: instructions per byte.
