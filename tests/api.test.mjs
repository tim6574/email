// Integration suite exercising the actual Cloudflare Worker handler with SQLite-backed D1 semantics.
// Run: node --experimental-sqlite tests/api.test.mjs (Node >=22)
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../worker/index.js';

const sql = readFileSync(new URL('../worker/migrations/0001_init.sql',import.meta.url),'utf8');
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON;');db.exec(sql);
const DB = {prepare(sql){
  const params=[];
  return {
    bind(...args){params.push(...args);return this;},
    async first(){return db.prepare(sql).get(...params) || null;},
    async all(){return {results:db.prepare(sql).all(...params)};},
    async run(){const output=db.prepare(sql).run(...params);return {meta:{changes:Number(output.changes)}};}
  };
}};
const env={DB,ALLOWED_ORIGINS:'http://localhost:8000,https://demo.github.io'};
const base='https://friendmail-test.workers.dev/api';
async function query(path,{method='GET',token='',body,origin='https://demo.github.io'}={}) {
  const headers={'Origin':origin};
  if(token) headers.Authorization=`Bearer ${token}`;
  if (body!==undefined) headers['Content-Type']='application/json';
  const request=new Request(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const response=await worker.fetch(request,env);
  return {status:response.status,body:response.headers.get('Content-Type')?.includes('json')?await response.json():new Uint8Array(await response.arrayBuffer()),headers:response.headers};
}
let alice,bob,charlie;
const smallPng='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl0PFEAAAAASUVORK5CYII=';

test('health reports database ready, rejects an untrusted origin',async()=>{
  const ok=await query('/health');assert.equal(ok.status,200);assert.equal(ok.body.status,'ok');
  const deny=await query('/health',{origin:'https://malicious.example'});
  assert.equal(deny.status,403);assert.equal(deny.headers.get('Access-Control-Allow-Origin'),null);
  const preflight=new Request(base+'/register',{method:'OPTIONS',headers:{Origin:'https://demo.github.io','Access-Control-Request-Method':'POST'}});
  const response=await worker.fetch(preflight,env);assert.equal(response.status,204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://demo.github.io');
});
test('registration validates usernames and passwords',async()=>{
  assert.equal((await query('/register',{method:'POST',body:{username:'x',password:'password123'}})).status,400);
  assert.equal((await query('/register',{method:'POST',body:{username:'alice',password:'short'}})).status,400);
  alice=await query('/register',{method:'POST',body:{username:'Alice',password:'Top-secret123'}});
  assert.equal(alice.status,200);assert.equal(alice.body.user.username,'alice');
  assert.ok(alice.body.token);
  bob=await query('/register',{method:'POST',body:{username:'bob',password:'Top-secret234'}});
  charlie=await query('/register',{method:'POST',body:{username:'charlie',password:'Top-secret345'}});
  assert.equal(bob.status,200);assert.equal(charlie.status,200);
  assert.equal((await query('/register',{method:'POST',body:{username:'ALICE',password:'Top-secret123'}})).status,409);
  assert.equal((await query('/login',{method:'POST',body:{username:'bob',password:'wrongsecret123'}})).status,401);
  assert.equal((await query('/me',{token:alice.body.token})).body.user.username,'alice');
});
test('friends suggestions max five; send, accept, reject unauthorized response, remove',async()=>{
  const at=alice.body.token,bt=bob.body.token;
  let overview=(await query('/friends/overview',{token:at})).body;
  assert.equal(overview.suggestions.length,2);
  assert.equal((await query('/friends/requests',{method:'POST',token:at,body:{username:'alice'}})).status,400);
  assert.equal((await query('/friends/requests',{method:'POST',token:at,body:{username:'no_one'}})).status,404);
  assert.equal((await query('/friends/requests',{method:'POST',token:at,body:{username:'bob'}})).status,200);
  assert.equal((await query('/friends/requests',{method:'POST',token:at,body:{username:'bob'}})).status,409);
  overview=(await query('/friends/overview',{token:bt})).body;
  assert.equal(overview.incoming.length,1);
  const id=overview.incoming[0].id;
  assert.equal((await query(`/friends/requests/${id}`,{method:'POST',token:charlie.body.token,body:{action:'accept'}})).status,403);
  assert.equal((await query(`/friends/requests/${id}`,{method:'POST',token:bt,body:{action:'accept'}})).status,200);
  assert.equal((await query(`/friends/requests/${id}`,{method:'POST',token:bt,body:{action:'accept'}})).status,404);
  overview=(await query('/friends/overview',{token:at})).body;
  assert.deepEqual(overview.friends.map(f=>f.username),['bob']);
  assert.equal((await query('/friends/bob',{method:'DELETE',token:at})).status,200);
  assert.equal((await query('/friends/overview',{token:at})).body.friends.length,0);
  // A new invitation may be sent after a previous connection was removed.
  assert.equal((await query('/friends/requests',{method:'POST',token:bt,body:{username:'alice'}})).status,200);
  const pending=(await query('/friends/overview',{token:at})).body.incoming[0].id;
  assert.equal((await query(`/friends/requests/${pending}`,{method:'POST',token:at,body:{action:'decline'}})).status,200);
});
test('mail send, receive, and deletion respects sender/recipient',async()=>{
  const at=alice.body.token, bt=bob.body.token;
  assert.equal((await query('/send',{method:'POST',token:at,body:{to:'nobody',subject:'Hey',body:'Hi'}})).status,404);
  assert.equal((await query('/send',{method:'POST',token:at,body:{to:'bob',subject:'Hello',body:'<b>Hello</b>'}})).status,200);
  let inbox=(await query('/inbox',{token:bt})).body.messages;
  assert.equal(inbox.length,1);assert.equal(inbox[0].from,'alice');assert.equal(inbox[0].body,'<b>Hello</b>');
  let sent=(await query('/sent',{token:at})).body.messages;
  assert.equal(sent.length,1);assert.equal(sent[0].id,inbox[0].id);
  const id=inbox[0].id;
  assert.equal((await query(`/messages/${id}`,{method:'DELETE',token:bt})).status,200);
  assert.equal((await query('/inbox',{token:bt})).body.messages.length,0);
  assert.equal((await query('/sent',{token:at})).body.messages.length,1);
  assert.equal((await query(`/messages/${id}`,{method:'DELETE',token:at})).status,200);
  assert.equal((await query('/sent',{token:at})).body.messages.length,0);
});
test('PNG avatar validates type; image can be fetched publicly and removed',async()=>{
  const at=alice.body.token;
  assert.equal((await query('/profile/avatar',{method:'POST',token:at,body:{image:'data:image/svg+xml;base64,AAAA'}})).status,400);
  const changed=await query('/profile/avatar',{method:'POST',token:at,body:{image:smallPng}});
  assert.equal(changed.status,200);assert.ok(changed.body.user.avatar_version>0);
  const image=await query('/avatars/alice');assert.equal(image.status,200);
  assert.deepEqual([...image.body.slice(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal((await query('/me',{token:at})).body.user.avatar_version,changed.body.user.avatar_version);
  const removed=await query('/profile/avatar',{method:'DELETE',token:at});assert.equal(removed.status,200);
  assert.equal(removed.body.user.avatar_version,0);
  assert.equal((await query('/avatars/alice')).status,404);
});
test('logout invalidates sessions',async()=>{
  const at=alice.body.token;
  assert.equal((await query('/logout',{method:'POST',token:at})).status,200);
  assert.equal((await query('/me',{token:at})).status,401);
});
