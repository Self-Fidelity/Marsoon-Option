import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

async function load(path) {
  const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

test('option stats joins exact candle buckets and distinguishes MissingOI zero',async()=>{
  const {buildOptionStatsModel}=await load('../src/features/board/option-stats-model.ts');
  const response={points:[
    {unix:60,window_low:90,window_high:110,net_gex:0,gross_gex:10,net_delta_notional:0,gross_delta_notional:20,net_charm_notional:0,gross_charm_notional:30,whole_net_gex:1,whole_net_delta_notional:2,whole_net_charm_notional:3,quality_flags:4,source_unix:65},
    {unix:120,window_low:90,window_high:110,net_gex:5,gross_gex:10,net_delta_notional:-4,gross_delta_notional:20,net_charm_notional:3,gross_charm_notional:30,whole_net_gex:6,whole_net_delta_notional:-5,whole_net_charm_notional:4,key_gamma_strike:105,key_delta_strike:100,key_charm_strike:95,quality_flags:0,source_unix:125},
    {unix:180,window_low:90,window_high:110,net_gex:9,gross_gex:10,net_delta_notional:8,gross_delta_notional:20,net_charm_notional:7,gross_charm_notional:30,whole_net_gex:9,whole_net_delta_notional:8,whole_net_charm_notional:7,quality_flags:0,source_unix:185},
  ],timeframe:60};
  const model=buildOptionStatsModel(response,[{unix:60},{unix:120},{unix:240}]);
  assert.deepEqual(model.barTimes,[60,120,240]);
  assert.equal(model.points.get(60).netGex,undefined);
  assert.deepEqual({net:model.points.get(120).netGex,ratio:model.points.get(120).gexRatio,change:model.points.get(120).gexChange,key:model.points.get(120).keyGammaStrike},{net:5,ratio:.5,change:undefined,key:105});
  assert.equal(model.points.has(180),false);
  assert.equal(model.points.has(240),false);
});

test('option stats change is only computed across contiguous buckets',async()=>{
  const {buildOptionStatsModel}=await load('../src/features/board/option-stats-model.ts');
  const point=(unix,net_gex)=>({unix,window_low:90,window_high:110,net_gex,gross_gex:10,net_delta_notional:1,gross_delta_notional:10,net_charm_notional:1,gross_charm_notional:10,whole_net_gex:net_gex,whole_net_delta_notional:1,whole_net_charm_notional:1,quality_flags:0,source_unix:unix});
  const model=buildOptionStatsModel({timeframe:60,points:[point(60,2),point(120,5),point(240,9)]},[{unix:60},{unix:120},{unix:240}]);
  assert.equal(model.points.get(120).gexChange,3);
  assert.equal(model.points.get(240).gexChange,undefined);
});

test('option stats metric settings preserve order and never become empty',async()=>{
  const {sanitizeOptionStatsMetrics}=await load('../src/features/board/option-stats-model.ts');
  assert.deepEqual(sanitizeOptionStatsMetrics(['netChex','bad','netGex','netChex']),['netChex','netGex']);
  assert.deepEqual(sanitizeOptionStatsMetrics([]),['netGex','netDex','netChex']);
});
