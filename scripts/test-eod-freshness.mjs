import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}}; cache.set(path,module.exports);
  const localRequire=(name)=>name==='@/lib/cme-session'?load('../src/lib/cme-session.ts'):require(name);
  new Function('require','module','exports',js)(localRequire,module,module.exports); cache.set(path,module.exports); return module.exports;
}
const {isCurrentPreviousEod}=load('../src/server/eod-freshness.ts');

test('previous EOD accepts only the immediately completed CME session',()=>{
 const now=Date.parse('2026-09-08T18:00:00+08:00');
 assert.equal(isCurrentPreviousEod(Date.parse('2026-09-07T21:00:00Z')/1000,now),true);
 assert.equal(isCurrentPreviousEod(Date.parse('2026-09-04T21:00:00Z')/1000,now),false);
 assert.equal(isCurrentPreviousEod(null,now),false);
});
