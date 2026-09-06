import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const calls = [];
class GoOptionsError extends Error { constructor(message, status) { super(message); this.status = status; } }
const source = fs.readFileSync(new URL('../src/app/api/options/dashboard/route.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', js)(() => ({
  GoOptionsError,
  params: (request) => { const query = new URL(request.url).searchParams; return { product: 'ES', scope: '0dte', query }; },
  dashboard: (...args) => { calls.push(args); return { has_data: true }; },
  route: async (work) => { try { return Response.json(await work()); } catch (error) { return Response.json({ error: error.message }, { status: error.status ?? 500 }); } },
}), module, module.exports);

test('historical dashboard forwards exact asof; current requests remain unchanged', async () => {
  await module.exports.GET(new Request('http://localhost/api/options/dashboard?days=1&asof=1788546600'));
  assert.deepEqual(calls.at(-1), ['ES', '0dte', 1, 1788546600]);
  await module.exports.GET(new Request('http://localhost/api/options/dashboard?days=1'));
  assert.deepEqual(calls.at(-1), ['ES', '0dte', 1, undefined]);
});

test('invalid asof fails instead of silently falling back to current data', async () => {
  const count = calls.length;
  for (const asof of ['', 'NaN', '0', '-1', '1.5', 'Infinity', '9007199254740992']) {
    const response = await module.exports.GET(new Request(`http://localhost/api/options/dashboard?asof=${asof}`));
    assert.equal(response.status, 400);
  }
  assert.equal(calls.length, count);
});
