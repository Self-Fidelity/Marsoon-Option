import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source=fs.readFileSync(new URL('../src/server/auth-session.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {signAuthSession,verifyAuthSession,accessTokenExpiration}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

test('signed auth session verifies and tampering fails closed',async()=>{
  const value=await signAuthSession({sub:'user-1',email:'user@example.com',exp:2000});
  assert.deepEqual(await verifyAuthSession(value,1000),{sub:'user-1',email:'user@example.com',exp:2000});
  assert.equal(await verifyAuthSession(value.replace('user','xuser'),1000),null);
  assert.equal(await verifyAuthSession(value,2000),null);
});

test('access token expiration reads the JWT payload only as metadata',()=>{
  const payload=Buffer.from(JSON.stringify({exp:12345})).toString('base64url');
  assert.equal(accessTokenExpiration(`header.${payload}.signature`),12345);
  assert.equal(accessTokenExpiration('development-token'),undefined);
});
