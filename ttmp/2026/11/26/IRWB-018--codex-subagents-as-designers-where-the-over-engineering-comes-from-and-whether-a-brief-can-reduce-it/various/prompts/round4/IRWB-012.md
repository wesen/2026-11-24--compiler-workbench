## Your program — ticket IRWB-012: a bytecode VM
A stack-machine bytecode interpreter written in Typed: an opcode `match` (or equivalent dispatch) in a loop, an operand stack and locals in `Int32Array`s, bytecode in a text buffer; plus small bytecode programs to run on it (for example fib, a sieve, insertion sort, a checksum).
- Why: an interpreter specialized on its bytecode is a compiled program (the first Futamura projection); this is IRWB-007's specialization idea on a small, controllable program. It also exercises dispatch lowering, keeping VM state in registers, bounds checks on stack and code accesses, and superinstructions.
- Oracle: the same bytecode on a JavaScript reference VM; specialized against unspecialized output.
- Measure: instructions per executed bytecode instruction, general and specialized.
