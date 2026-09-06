import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/instrument-labels.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { productName, instrumentName, localizeInstrumentText, optionSeriesName } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const reference = Date.parse('2026-09-04T12:00:00Z') / 1000;
test('Chinese names preserve futures month and year distinctions', () => {
  assert.equal(productName('nq'), '纳指');
  assert.equal(productName('ES'), '标普');
  assert.equal(productName('GC'), '黄金');
  assert.equal(instrumentName('NQU6', reference), '纳指·2026年9月');
  assert.equal(instrumentName('GCZ26', reference), '黄金·2026年12月');
  assert.equal(instrumentName('ESH0', reference), '标普·2030年3月');
  assert.equal(instrumentName('UNKNOWN'), '未识别合约');
});
test('display text translates tickers without corrupting GEX or raw series identifiers', () => {
  assert.equal(localizeInstrumentText('NQ / ES / gc：GEX DEX ATM IV'), '纳指 / 标普 / 黄金：GEX DEX ATM IV');
  const series = { code: 'QN1U6', futures: 'NQU6', expiration: reference, kind: 'weekly' };
  const label = optionSeriesName(series, 'NQ');
  assert.match(label, /纳指.*2026年9月.*到期.*周度/);
  assert.doesNotMatch(label, /NQ|QN1U6/);
  assert.equal(series.code, 'QN1U6');
  assert.equal(series.futures, 'NQU6');
});
