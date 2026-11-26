// Encode and decode 24 A cells on a fresh program.
p.pipeline('speed');
const image = p.compile({ chains: true, coalesce: true, homes: true });
const input = Array(24).fill(65);
const scratch = () => Array(24).fill(0);
const encoded = image.run('compress', [input, scratch(), 3]);
const decoded = image.run('roundTrip', [input, scratch(), scratch(), 3]);
return {
  packed: encoded.buffers[1].cells.slice(0, encoded.result),
  decoded: decoded.buffers[2].cells.slice(0, decoded.result),
  instructions: decoded.steps,
};
