# f32 DSP

`fft` computes an unnormalized forward complex transform for `n = 8` or
`16`. It works in place in a 32-float buffer with alternating real and
imaginary lanes. At size 8 it leaves the final 16 floats untouched. Its
read-only table contains the first eight complex roots for size 16.
The butterfly's `stride` selects the roots for the current stage.

`biquadBank` runs two direct-form-I filters over the same 16 real samples.
Each coefficient row is `b0, b1, b2, a1, a2`, with denominator
`1 + a1*z^-1 + a2*z^-2`. Each band starts with zero history and writes
16 consecutive floats starting at `16 * band`. The samples and
coefficients are read-only.

Each float occupies two u16 cells, low half first. Generated samples
are finite and lie in `[-1, 1]`. Each call uses separate buffers.

Follow `tr` and `ti` from the butterfly's products to its four stores.
In the filter, compare the call to `dot3` at r0 with the inlined
multiply-add chain after `speed`. The `compare` script reports RV32
instructions for a fixed input to each kernel on a fresh copy.
