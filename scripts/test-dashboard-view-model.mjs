import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/features/options/dashboard-view-model.ts',import.meta.url),'utf8');
let js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
js=js.replace('import { optionProductConfig, } from "../../api/options";','const optionProductConfig={NQ:{multiplier:20,tickSize:.25},ES:{multiplier:50,tickSize:.25},GC:{multiplier:100,tickSize:.1}};');
const {buildDashboardViewModel}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('GEX profile keeps every strike and quality flag from the selected contract',()=>{
  const now=2_000_000_000;
  const cells=Array.from({length:30},(_,index)=>({
    unix:now,expiration:now+86400,underlying_symbol:'GCZ6',strike:4000+index*5,
    call_gex:100+index,put_gex:-50,gross_gex:150+index,quality_flags:index%2?1028:256,
  }));
  cells.push({...cells[0],underlying_symbol:'GCV6',strike:9999});
  const response={source:'test',product:'GC',scope:'d30',snapshot_unix:now,has_data:true,
    market_state:{unix:now,expiration:0,underlying_symbol:'GCZ6',underlying_price:4500,quality_flags:0},
    summary:{underlying_price:4500,regime:'positive_gamma',net_gex:1,gross_gex:2,quality_flags:0},
    expiries:[],heatmap:{observed_min_unix:now,observed_max_unix:now,cells,levels:[]}};
  const model=buildDashboardViewModel(response,'d30',now);
  assert.equal(model.gammaRows.length,30);
  assert.equal(model.allGammaRows.length,30);
  assert.equal(model.gammaRows.some(row=>row.strike===9999),false);
  assert.equal(model.allGammaRows.some(row=>row.strike===9999),false);
  assert.equal(model.gammaRows.every(row=>row.qualityFlags!==0),true);
});

test('overview keeps every strike while the GEX table still windows to 40',()=>{
  const now=2_000_000_000;
  const cells=Array.from({length:50},(_,index)=>({
    unix:now,expiration:now+86400,underlying_symbol:'NQU6',strike:20000+index*25,
    call_gex:10+index,put_gex:-8,gross_gex:18+index,quality_flags:0,
  }));
  const response={source:'test',product:'NQ',scope:'0dte',snapshot_unix:now,has_data:true,
    market_state:{unix:now,expiration:now+86400,underlying_symbol:'NQU6',underlying_price:20600,quality_flags:0},
    summary:{underlying_price:20600,regime:'positive_gamma',net_gex:1,gross_gex:2,quality_flags:0},
    expiries:[],heatmap:{observed_min_unix:now,observed_max_unix:now,cells,levels:[]}};
  const model=buildDashboardViewModel(response,'0dte',now);
  assert.equal(model.allGammaRows.length,50);
  assert.equal(model.gammaRows.length,40);
  assert.ok(model.gammaRows.some(row=>row.strike===20600));
});
