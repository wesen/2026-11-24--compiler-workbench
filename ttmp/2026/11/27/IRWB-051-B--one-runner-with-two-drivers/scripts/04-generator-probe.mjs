// Initial Node driver capability probe.
function* pause() {
  return yield 2;
}
const runner = pause();
console.log(runner.next(), runner.next(3));
