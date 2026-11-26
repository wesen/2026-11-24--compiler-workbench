"""Locate the shared exceptional input relative to the binary32 midpoint."""
from decimal import Decimal, localcontext
import struct

def exact(bits):
    x, = struct.unpack(">f", bytes.fromhex(bits))
    return Decimal.from_float(x)

for precision in (60, 100):
    with localcontext() as ctx:
        ctx.prec = precision
        x = exact("c16912cd")
        lo, hi = exact("34fd331a"), exact("34fd331b")
        mid = (lo + hi) / 2
        offset = x.exp() - mid
        # Both outputs have biased binary32 exponent 105; binary64 has 29 extra fraction bits.
        print(f"prec={precision} x={x} midpoint={mid} above_midpoint={offset:.12E} "
              f"f32_ulp={offset/(hi-lo):.12E} f64_ulp={offset/(hi-lo)*2**29:.12E}")
        assert 0 < offset < (hi-lo)/2
