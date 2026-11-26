## Your program — ticket IRWB-014: an LZ-style compressor and decompressor
Hash-chain match finding over a text buffer, literal and match encoding, and a decompressor, in Typed.
- Why: dense memory accesses and bounds checks, including checks that need relations between indices (`i + len <= n`, back-references) — the kind insertion sort still loses on; byte and bit twiddling for rule discovery; loop-carried dependencies.
- Oracle: a round trip, `decompress(compress(x)) == x`, which holds on any input, so generated cases are meaningful.
