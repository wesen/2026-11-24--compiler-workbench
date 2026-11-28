// Physical source lines, inclusive of declarations and braces. Run from repo root.
import {readFileSync} from 'node:fs';
const lines = readFileSync('src/framework/contracts/analysis-manager.ts','utf8').split('\n');
const at = text => {
  const index = lines.findIndex(line => line.startsWith(text));
  if (index < 0) throw new Error('Missing region '+text);
  return index;
};
for (const [name,start,end,tail] of [
  ['public analyseSync','  analyseSync<','  private async analyseInternal',0],
  ['shared lookup and record builder','  private analysisRequest<','      runAsync: async',1],
  ['async miss','      runAsync: async','      runSync: ()',0],
  ['sync miss','      runSync: ()','  hasAnalysis<',2],
]) console.log(name,at(end)-at(start)-tail);
