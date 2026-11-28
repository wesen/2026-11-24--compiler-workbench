#!/usr/bin/env node
// IRWB-051-C probe 02: how a synchronous driver can abandon a generator that yielded a promise. gen.throw(e) is
// catchable by the generator (a `try { yield* preserve } catch { recompute }` in the runner would swallow the
// driver's refusal); gen.return() runs only the finally blocks, and a yield inside a finally is passed by calling
// return() again.
const log = [];
function* inner() {
  try {
    yield Promise.resolve(1);
  } finally {
    try {
      yield Promise.allSettled([]);
      log.push('after the yield in finally: not reached on return()');
    } finally {
      log.push('inner closed');
    }
  }
}
function* outer() {
  let accepted = false;
  try {
    try {
      yield* inner();
    } catch {
      log.push('outer catch: not reached on return()');
    }
    accepted = true;
  } finally {
    if (!accepted) log.push('outer cleanup');
  }
}
const g = outer();
let s = g.next();
let returns = 0;
do {
  s = g.return(undefined);
  returns++;
} while (!s.done);
console.log(JSON.stringify(log), '| return() calls:', returns);
