The allocator is a linear scan over live intervals. `ui/intervals.js`
registers a component that draws them; `ui/registers.js` puts the
allocator's options in sliders and toggles and shows one function;
`ui/spill-curve.js` sweeps the register count with a task that replays
the open program's passes on fresh copies (`scripts/replay.js`), so the
program you are looking at gets no new images.

The parameters are shared: the order and spill choices in the Registers
tile also restart the sweep.
