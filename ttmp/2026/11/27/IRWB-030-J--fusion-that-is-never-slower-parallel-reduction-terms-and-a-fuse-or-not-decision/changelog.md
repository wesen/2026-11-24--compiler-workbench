# Changelog

## 2026-11-27

- Initial workspace created

## 2026-11-27

Stage 3b: parallel reduction terms staged by the block and folded in order by thread 0 (inside layernorm 0.569 to 0.220 ms); decline rule for contraction chains below 65536 points x threads from the measured sweep; CUDA artifact v3 records each kernel's staged reductions; 80/80 random lowerings exact; no framework change (finding: the transformation has no port for launch shapes)
