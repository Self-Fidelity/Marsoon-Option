import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/lib/data-messages.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function('require','module','exports',js)(()=>({localizeInstrumentText:(value)=>value}),module,module.exports);
const {dataAvailabilityMessage,sanitizePublicMessage,sanitizePublicData}=module.exports;

test('internal providers, endpoints and tickers never reach availability copy',()=>{
  const fallback='当前暂无可用数据';
  for(const message of [
    'Go option service timeout',
    'Databento provider unavailable',
    'ticker NQU6 missing from /options/chain',
    'https://mws.marsoon.cn returned HTTP 502',
    '请求 ESU6，后端返回其他合约',
  ]) assert.equal(dataAvailabilityMessage(message,fallback),fallback);
  assert.equal(sanitizePublicMessage('当前交易日暂无有效报价','加载失败'),'当前交易日暂无有效报价');
});

test('browser payloads hide internal sources and empty-state identifiers',()=>{
  const result=sanitizePublicData({
    source:'databento-go',has_data:false,product:'NQ',underlying_symbol:'NQU6',
    missing_reason:'Databento ticker NQU6 timeout',
    nested:{futures:'NQU6',series_id:'secret',source:'options-http'},
  });
  assert.deepEqual(result,{
    source:'market-data',has_data:false,product:'NQ',
    missing_reason:'当前暂无可用数据，请稍后重试。',
    nested:{source:'market-data'},
  });
});
