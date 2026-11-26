## Your program — ticket IRWB-016: f32 DSP
An iterative radix-2 FFT and a biquad filter bank, in f32, in Typed.
- Why: float-heavy straight-line code; the FFT size and the coefficients are natural specialization constants (twiddle factors folded at compile time); reassociation and fused multiply-add change the last bits, which is IRWB-011's tolerance-contract question.
- Oracle: bit-exact against r0 for exact pipelines; an error bound in dB against a float64 JavaScript reference for tolerance pipelines.
