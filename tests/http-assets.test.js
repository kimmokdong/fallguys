import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {createGameServer} from '../server.js';
import {MUSIC_TRACKS} from '../public/music.js';
test('정적 파일 압축·ETag·HEAD·협상과 오디오 Range를 실제 HTTP로 검증한다',async t=>{
 const app=createGameServer();app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());const url='http://127.0.0.1:'+app.server.address().port;
 const expected=await readFile(new URL('../public/app.js',import.meta.url),'utf8');let etag;
 for(const encoding of ['br','gzip','identity','br;q=0, gzip;q=0']) {
  const r=await fetch(url+'/app.js',{headers:{'Accept-Encoding':encoding}});assert.equal(await r.text(),expected);assert.equal(r.headers.get('vary'),'Accept-Encoding');
  if(encoding==='br'||encoding==='gzip') {assert.equal(r.headers.get('content-encoding'),encoding);assert.ok(Number(r.headers.get('content-length'))<Buffer.byteLength(expected)*.45);}else assert.equal(r.headers.get('content-encoding'),null);
  const hit=await fetch(url+'/app.js',{headers:{'Accept-Encoding':encoding,'If-None-Match':r.headers.get('etag')}});assert.equal(hit.status,304);assert.equal((await hit.arrayBuffer()).byteLength,0);
  const head=await fetch(url+'/app.js',{method:'HEAD',headers:{'Accept-Encoding':encoding}});assert.equal(head.headers.get('content-length'),r.headers.get('content-length'));if(encoding==='br')etag=r.headers.get('etag');
 }
 const other=await fetch(url+'/app.js',{headers:{'Accept-Encoding':'identity','If-None-Match':etag}});assert.equal(other.status,200);
 const music=await readFile(new URL('../public'+MUSIC_TRACKS[0],import.meta.url));const r=await fetch(url+MUSIC_TRACKS[0],{headers:{Range:'bytes=100-199'}});assert.equal(r.status,206);assert.deepEqual(Buffer.from(await r.arrayBuffer()),music.subarray(100,200));assert.equal(r.headers.get('accept-ranges'),'bytes');
 const tail=await fetch(url+MUSIC_TRACKS[0],{headers:{Range:'bytes=-10'}});assert.equal(tail.status,206);assert.deepEqual(Buffer.from(await tail.arrayBuffer()),music.subarray(-10));
 assert.equal((await fetch(url+MUSIC_TRACKS[0],{headers:{Range:'bytes=999999999-'}})).status,416);
});
