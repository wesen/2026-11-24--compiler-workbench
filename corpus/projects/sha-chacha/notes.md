# SHA-256 and ChaCha20

Each external word occupies two u16 cells, low half first. Both kernels
return the first output word as a signed i32 and write the complete
block result to a separate output buffer.

- `sha256Block(message, roundK, out)` accepts 0–55 ASCII cells. Pass the
  128-cell constant table from project metadata and a 16-cell output
  buffer. Serialize the eight digest words big-endian.
- `chacha20Block(key, counter, nonce, out)` takes a 16-cell key, a
  full-width i32 counter and a 6-cell nonce. Pack the key and nonce
  bytes little-endian. The 32-cell output serializes to 64 little-endian
  keystream bytes.

Follow the SHA-256 compression loop after the frame-backed message
schedule is built. Its indexed constant load and eight scalar state
updates repeat 64 times. ChaCha20's ten double rounds apply four column
and four diagonal quarter rounds per iteration. The 16 scalar working
words stay live across the quarter rounds. Inspect the hot listings for
shift/OR rotates, state copies and stack spill traffic. The image's
hottest instruction IDs link back to the RV32 listing.

Run the fresh `explore` script to compare r0 with checked `speed` on a
55-character SHA message and the RFC ChaCha20 block case using the same
`coalesce`, `chains` and `homes` options. Instructions per byte divides
the emulator's executed instructions by 64 in both cases, including
setup and stores. SHA-256 processes one 64-byte padded block and
ChaCha20 emits 64 keystream bytes.

- [FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)
- [RFC 8439](https://www.rfc-editor.org/rfc/rfc8439.html#section-2.3.2)
