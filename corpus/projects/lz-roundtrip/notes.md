# LZ round trip

The input holds up to 24 seven-bit characters, one per u16 cell. Pass
distinct 24-cell buffers for the packed stream and decoded output. The
chain limit is 1–3. `compress` returns the number of packed cells. Pass
that length to `decompress`, which requires a valid stream that expands
to at most 24 cells and returns the number of decoded cells. `roundTrip`
connects the two calls.

Each packed cell holds one byte.

| Bits | Meaning |
| --- | --- |
| `0ccccccc` | Emit the literal character `c` (0–127). |
| `1llddddd` | Copy `ll + 3` cells from `ddddd + 1` cells back. |

The compressor visits hash-chain links newest first and keeps the
nearest match on ties. It inserts all consumed positions that begin a
complete triple. The decoder copies forward, so a distance-one match
can extend a run by reading cells from earlier iterations of the same
copy loop.

Run this in the workbench console with the project open to encode and
decode 24 A cells on a fresh optimized program.

```js
return wb.projects.current.run('explore');
```

The packed prefix is `[65, 224, 224, 224, 192]`. The script also returns
all 24 decoded cells and the RV32 instruction count for the round trip.

The next console example encodes `AABBAAB` with one and two chain
visits.

```js
const input = [65, 65, 66, 66, 65, 65, 66];
return [1, 2].map(limit => {
  const run = p.exec('compress', [input, Array(24).fill(0), limit]);
  return run.buffers[1].cells.slice(0, run.result);
});
```

One visit yields seven literals. Two visits yield
`[65, 65, 66, 66, 131]` because the older `AAB` matches at distance four
after the newer `BAA` collides in the same bucket.
