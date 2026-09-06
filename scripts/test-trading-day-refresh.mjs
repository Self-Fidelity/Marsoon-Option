import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

let source=fs.readFileSync(new URL('../src/features/options/trading-day-refresh.ts',import.meta.url),'utf8');
source=source.replace(/import \{ useEffect, useState \} from "react";\n/,'');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {cmeTradingDayKey,tradingDayQueryPolicy}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('CME trading day changes at 17:00 CT on weekdays',()=>{
  assert.equal(cmeTradingDayKey(Date.parse('2025-06-09T21:59:00Z')),'2025-06-09');
  assert.equal(cmeTradingDayKey(Date.parse('2025-06-09T22:00:00Z')),'2025-06-10');
});

test('weekend keeps Friday until Sunday 17:00 CT',()=>{
  assert.equal(cmeTradingDayKey(Date.parse('2025-06-14T18:00:00Z')),'2025-06-13');
  assert.equal(cmeTradingDayKey(Date.parse('2025-06-15T21:59:00Z')),'2025-06-13');
  assert.equal(cmeTradingDayKey(Date.parse('2025-06-15T22:00:00Z')),'2025-06-16');
});

test('dashboard policy has no minute, focus or reconnect refresh',()=>{
  assert.equal(tradingDayQueryPolicy.staleTime,Infinity);
  assert.equal(tradingDayQueryPolicy.refetchInterval,false);
  assert.equal(tradingDayQueryPolicy.refetchOnWindowFocus,false);
  assert.equal(tradingDayQueryPolicy.refetchOnReconnect,false);
});
