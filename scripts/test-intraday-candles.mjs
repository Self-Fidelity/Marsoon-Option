import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
async function load(path) {const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)}
const {attachAvailableCandles,sessionStart,validMinuteBars}=await load('../src/server/intraday-candles.ts');
const {pickIntradayBars,sameUnderlying}=await load('../src/features/board/intraday-data.ts');
const from=Date.parse('2026-09-03T22:00:00Z')/1000, now=from+3600;
const bar={unix:from,open:100,high:102,low:99,close:101,volume:7,final:true};
const original={product:'GC',scope:'0dte',underlying_symbol:'GCV6',day:'2026-09-04',has_data:true,bars:[],levels:[{t:from,call_wall:98}],current:{spot:100}};
test('uses Chicago session boundaries in summer and winter',()=>{
 assert.equal(sessionStart('2026-09-04'),from);
 assert.equal(sessionStart('2026-01-06'),Date.parse('2026-01-05T23:00:00Z')/1000);
 assert.equal(sessionStart('2026-03-10'),Date.parse('2026-03-09T22:00:00Z')/1000);
 assert.throws(()=>sessionStart('2026-02-31'));
});
test('keeps existing same-contract bars without extra calls',async()=>{
 const result=await attachAvailableCandles({...original,bars:[bar]},'GC',async()=>{throw Error('unexpected API call')},now);
 assert.equal(result.candle_underlying_symbol,'GCV6');assert.equal(result.current.spot,100);assert.equal(result.candle_is_reference,false);
});
test('reads the existing minute-bar interface and labels another contract honestly',async()=>{
 const calls=[];
 const result=await attachAvailableCandles(original,'GC',async(path,q)=>{
  calls.push({path,q});
  if(path==='/options/status')return {entries:[{product:'GC',scope:'nearest',expiration:now+86400,underlying_symbol:'GCZ6'}]};
  return {underlying_symbol:q.underlying,bars:q.underlying==='GCZ6'?[bar]:[]};
 },now);
 assert.equal(result.underlying_symbol,'GCV6');assert.equal(result.candle_underlying_symbol,'GCZ6');assert.equal(result.candle_is_reference,true);assert.match(result.candle_notice,/GCV6/);
 assert.deepEqual(original.bars,[]);assert.equal(calls[0].q.timeframe,60);assert.equal(calls[0].q.from,from);assert.equal(result.bars[0].volume,7);
 assert.equal(sameUnderlying(result.underlying_symbol,result.candle_underlying_symbol),false);
});
test('falls back to the latest real CME trading day when the current short range is empty',async()=>{
 const old={...bar,unix:from-86400};
 const result=await attachAvailableCandles(original,'GC',async(path,q)=>{
  if(path==='/options/status')return {entries:[]};
  return {underlying_symbol:q.underlying,bars:q.from<from?[old]:[]};
 },now,'GCV6',{from,to:now});
 assert.equal(result.candle_underlying_symbol,'GCV6');assert.equal(result.candle_is_reference,false);
 assert.deepEqual(result.bars,[old]);assert.match(result.candle_notice,/最近有数据/);
});
test('uses primary-scope bars and excludes different-underlying overlays',()=>{
 const secondary={...original,underlying_symbol:'GCZ6',bars:[bar]},primary={...original,bars:[bar]};
 const selected=pickIntradayBars([{scope:'d30',data:secondary},{scope:'0dte',data:primary}],'0dte');
 assert.equal(selected,primary);assert.equal(sameUnderlying(secondary.underlying_symbol,selected.underlying_symbol),false);assert.equal(sameUnderlying(undefined,'GCV6'),false);
});
test('deduplicates minutes without inventing gap bars or summing repeated volume',()=>{
 const result=validMinuteBars([bar,{...bar,volume:9},{...bar,unix:from+120},{...bar,unix:from+60,low:103}],from,from+180);
 assert.equal(result.length,2);assert.equal(result[0].volume,9);assert.equal(result[1].unix,from+120);
});
