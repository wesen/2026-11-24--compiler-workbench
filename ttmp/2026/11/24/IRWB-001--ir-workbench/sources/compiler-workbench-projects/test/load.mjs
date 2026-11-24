import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
export const SITE = "/home/claude/wb2/site/";
const REPO = "/home/claude/wesen/2026-10-20--ds-js-os/picocalc-os/";
export function load(extra = []) {
  const ctx = vm.createContext({ console, performance, setTimeout, clearTimeout, atob, btoa });
  ctx.globalThis = ctx;
  const files = ["vendor/typed-wasm.js", "vendor/rv32-interp.js", ...["base", "store", "evaluator", "analyses", "passes", "handles", "backend", "projects", "api"].map(n => `app/engine/${n}.js`), ...extra];
  for (const f of files) { try { vm.runInContext(readFileSync(SITE + f, "utf8"), ctx, { filename: f }); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  vm.runInContext(readFileSync(REPO + "compiler/typed-rv32.js", "utf8"), ctx, { filename: "typed-rv32.js" });
  return ctx;
}
