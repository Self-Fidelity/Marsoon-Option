import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/features/board/expiration-heatmap-model.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {buildExpirationHeatmapModel,displayHeatmapValue,heatmapCellKey}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const day=Date.parse('2026-09-05T00:00:00Z')/1000;
const base={unix:day,strike:20000,underlying_symbol:'NQU6',call_gex:10,put_gex:-4,quality_flags:0};
const vm={snapshotUnix:day,heatmapCells:[],surfaceLevels:[],spot:20000,tickSize:.25,scope:'d30',hasQualityWarnings:false};

test('folds series into UTC calendar days and caps the surface at 30 days',()=>{
  vm.heatmapCells=[...Array(35)].flatMap((_,i)=>[
    {...base,expiration:day+i*86400+3600,net_delta_notional:5,net_charm_notional:-2,call_oi:8,put_oi:3},
    {...base,expiration:day+i*86400+7200,call_gex:2,put_gex:-1,net_delta_notional:7,net_charm_notional:1,call_oi:2,put_oi:4},
  ]);
  const model=buildExpirationHeatmapModel(vm,[],'all','2026-09-05');
  assert.equal(model.expirations.length,30);
  assert.equal(model.truncatedExpirations,5);
  const cell=model.cells.get(heatmapCellKey(day,20000));
  assert.equal(cell.netGex,7);
  assert.equal(cell.netDelta,12);
  assert.equal(cell.netCharm,-1);
  assert.equal(cell.oiImbalance,3);
});

test('only MissingOI model zero becomes unavailable; BelowMinOI is not filtered',()=>{
  assert.equal(displayHeatmapValue(0,4),undefined);
  assert.equal(displayHeatmapValue(0,1028),undefined);
  assert.equal(displayHeatmapValue(0,1024),0);
  assert.equal(displayHeatmapValue(12,4),12);
});

test('official daily model never sums a different minute snapshot',()=>{
  const model=buildExpirationHeatmapModel({...vm,heatmapCells:[
    {...base,expiration:day+86400,call_gex:10,put_gex:-4},
    {...base,unix:day-60,expiration:day+86400,call_gex:1000,put_gex:-400},
  ]});
  const cell=model.cells.get(heatmapCellKey(day+86400,20000));
  assert.equal(cell.callGex,10);
  assert.equal(cell.putGex,-4);
  assert.equal(cell.netGex,6);
});

test('front-expiry view uses the trading-date expiration when present',()=>{
  const model=buildExpirationHeatmapModel({...vm,heatmapCells:[
    {...base,expiration:day+3600},
    {...base,expiration:day+86400+3600},
  ]},[],'front','2026-09-05');
  assert.deepEqual(model.expirations,[day]);
  assert.equal(model.frontExpirationFallback,false);
});

test('front-expiry view falls back to the nearest listed expiration',()=>{
  const model=buildExpirationHeatmapModel({...vm,heatmapCells:[
    {...base,expiration:day+3*86400},
    {...base,expiration:day+7*86400},
  ]},[],'front','2026-09-05');
  assert.deepEqual(model.expirations,[day+3*86400]);
  assert.equal(model.frontExpirationFallback,true);
});

test('front-expiry view still shows the last listed expiration after the trading date has passed',()=>{
  const model=buildExpirationHeatmapModel({...vm,heatmapCells:[
    {...base,expiration:day-86400},
  ]},[],'front','2026-09-05');
  assert.deepEqual(model.expirations,[day-86400]);
  assert.equal(model.frontExpirationFallback,true);
});

test('all-expiry view includes later futures expirations',()=>{
  const model=buildExpirationHeatmapModel({...vm,scope:'d90',heatmapCells:[
    {...base,expiration:day+10*86400},
    {...base,underlying_symbol:'NQZ6',expiration:day+60*86400},
  ]},[],'all','2026-09-05');
  assert.deepEqual(model.expirations,[day+10*86400,day+60*86400]);
});

test('keeps quality-flagged cells visible so partial one-sided data does not erase a strike row',()=>{
  const model=buildExpirationHeatmapModel({...vm,heatmapCells:[{...base,expiration:day,quality_flags:1028,net_delta_notional:-1175213}]});
  const cell=model.cells.get(heatmapCellKey(day,20000));
  assert.equal(model.strikes.length,1);
  assert.equal(cell.qualityFlags,1028);
  assert.equal(cell.netDelta,-1175213);
});

test('missing optional calculations stay missing instead of becoming zero',()=>{
  const model=buildExpirationHeatmapModel({...vm,heatmapCells:[{...base,expiration:day},{...base,expiration:day+3600,net_delta_notional:12,call_oi:2,put_oi:1}]});
  const cell=model.cells.get(heatmapCellKey(day,20000));
  assert.equal(cell.netDelta,undefined);
  assert.equal(cell.oiImbalance,undefined);
});

test('falls back to the densest minute when no cell matches snapshot unix',()=>{
  const model=buildExpirationHeatmapModel({...vm,snapshotUnix:day,heatmapCells:[
    {...base,unix:day+60,expiration:day,call_gex:10,put_gex:-4},
    {...base,unix:day+60,expiration:day,strike:20100,call_gex:2,put_gex:-1},
    {...base,unix:day+120,expiration:day,call_gex:1000,put_gex:-400},
  ]},[],'front','2026-09-05');
  assert.equal(model.strikes.length,2);
  assert.equal(model.cells.get(heatmapCellKey(day,20000)).callGex,10);
  assert.equal(model.cells.get(heatmapCellKey(day,20100)).callGex,2);
});

test('canonical call_oi_wall maps onto the call-wall marker',()=>{
  const model=buildExpirationHeatmapModel({
    ...vm,
    heatmapCells:[{...base,expiration:day}],
    surfaceLevels:[{unix:day,expiration:day,metric:'call_oi_wall',level:20000,rank:1}],
  },[],'front','2026-09-05');
  assert.equal(model.expiryLevels.get(day).callWall,20000);
});
