import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

async function load(path) {
  let source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
  if (source.includes('./lightweight-profile-bins')) {
    const helperSource=fs.readFileSync(new URL('../src/features/board/lightweight-profile-bins.ts',import.meta.url),'utf8');
    const helperJs=ts.transpileModule(helperSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
    const helperUrl=`data:text/javascript;base64,${Buffer.from(helperJs).toString('base64')}`;
    source=source.replace('./lightweight-profile-bins',helperUrl);
  }
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

test('option volume profile maps the session endpoint and omits empty strikes',async()=>{
  const {buildOptionVolumeProfileModel}=await load('../src/features/board/option-volume-profile-model.ts');
  const response={source_from:40,source_to:100,fallback:false,rows:[
    {strike:100,call_volume:7,put_volume:2},
    {strike:90,call_volume:0,put_volume:5},
    {strike:80,call_volume:0,put_volume:0},
  ]};
  assert.deepEqual(buildOptionVolumeProfileModel(response),{
    snapshotUnix:100,
    rows:[
      {strike:100,callVolume:7,putVolume:2},
      {strike:90,callVolume:0,putVolume:5},
    ],
    isFallback:false,
  });
});

test('profile bin height is one tick mapped through the price scale',async()=>{
  const {profileBinHeight}=await load('../src/features/board/lightweight-profile-bins.ts');
  assert.equal(profileBinHeight(100,2,(price)=>price*2),4);
  assert.equal(profileBinHeight(100,.25,(price)=>price),1);
  assert.equal(profileBinHeight(100,0,(price)=>price),1);
});

test('option volume bars use dynamic bin heights and honor the right inset',async()=>{
  const {OptionVolumeProfilePrimitive}=await load('../src/features/board/lightweight-option-volume-profile.ts');
  const rects=[];
  const context={save(){},restore(){},fillRect(...args){rects.push(args)},fillText(){}};
  const primitive=new OptionVolumeProfilePrimitive();
  primitive.attached({series:{priceToCoordinate:(strike)=>(110-strike)*2},requestUpdate(){}});
  primitive.configure([{strike:100,callVolume:10,putVolume:5},{strike:90,callVolume:7,putVolume:4},{strike:80,callVolume:3,putVolume:2}],180,200,2,{buy:'#0f0',sell:'#f00',text:'#fff',border:'#333'});
  primitive.paneViews()[0].renderer().draw({useMediaCoordinateSpace:(draw)=>draw({context,mediaSize:{width:1000,height:500}})});
  const bars=rects.filter(([, , width, height])=>height<=18&&width>0);
  assert.equal(bars.length,6);
  assert.deepEqual([...new Set(bars.map(([, , ,height])=>height))],[4]);
  assert.equal(Math.max(...bars.map(([, , width])=>width)),83);
  assert.ok(bars.every(([x])=>x<800));
});

test('option OI profile uses call/put OI and the same dynamic bins',async()=>{
  const {OptionOiProfilePrimitive}=await load('../src/features/board/lightweight-gex-profile.ts');
  const rects=[];
  const context={save(){},restore(){},fillRect(...args){rects.push(args)},fillText(){}};
  const primitive=new OptionOiProfilePrimitive();
  primitive.attached({series:{priceToCoordinate:(strike)=>(110-strike)*2},requestUpdate(){}});
  primitive.configure([{strike:100,callOI:10,putOI:5,callGEX:1e9,putGEX:-1e9},{strike:90,callOI:7,putOI:4,callGEX:0,putGEX:0},{strike:80,callOI:3,putOI:2,callGEX:0,putGEX:0}],180,2,{background:'#000',buy:'#0f0',sell:'#f00',text:'#fff',border:'#333'});
  primitive.paneViews()[0].renderer().draw({useMediaCoordinateSpace:(draw)=>draw({context,mediaSize:{width:1000,height:500}})});
  const bars=rects.filter(([, , width,height])=>height<=18&&width>0);
  assert.equal(bars.length,6);
  assert.deepEqual([...new Set(bars.map(([, , ,height])=>height))],[4]);
  assert.equal(Math.max(...bars.map(([, ,width])=>width)),83);
});
