import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const built = await build({entryPoints:['src/storage/rail-image-cache.ts'],bundle:true,write:false,format:'esm'});
const {RailImageCache} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));

test('rail cache evicts by byte size and recency, and never retains an oversized image',async()=>{
  const cache=new RailImageCache(10,3),reads=[];
  const host={readImage:async path=>{reads.push(path);return new Blob([new Uint8Array(path==='huge'?11:4)]);}};
  const a=await cache.read(host,'a');await cache.read(host,'b');
  assert.equal(cache.get('a'),a);
  await cache.read(host,'c');
  assert.equal(cache.get('b'),undefined);assert.equal(cache.get('a'),a);
  await cache.read(host,'b');assert.equal(reads.filter(p=>p==='b').length,2);
  assert.equal((await cache.read(host,'huge')).size,11,'oversized image still reaches the current tile');
  assert.equal(cache.get('huge'),undefined);
  assert.equal(a.size,4,'eviction does not invalidate bytes already handed to a tile');
});

test('rail cache bounds tiny entries and counts data URL string memory',async()=>{
  const cache=new RailImageCache(1000,2),host={readImage:async()=>new Blob(['x'])};
  for(let i=0;i<10;i++) await cache.read(host,String(i));
  assert.equal(cache.get('0'),undefined);assert.equal(cache.get('7'),undefined);assert.ok(cache.get('9'));
  const url='data:image/png;base64,AAAA',strings=new RailImageCache(url.length*2,10);
  await strings.read({readImage:async()=>url},'a');await strings.read({readImage:async()=>url},'b');
  assert.equal(strings.get('a'),undefined);assert.equal(strings.get('b'),url);
});

test('rail cache shares concurrent reads and releases failed requests for retry',async()=>{
  const cache=new RailImageCache();let calls=0,release;
  const gate=new Promise(r=>release=r),host={readImage:async()=>{calls++;await gate;return new Blob(['x']);}};
  const a=cache.read(host,'a'),b=cache.read(host,'a');release();
  assert.equal(await a,await b);assert.equal(calls,1);
  await assert.rejects(cache.read({readImage:async()=>{throw Error('missing');}},'retry'),/missing/);
  assert.ok(await cache.read(host,'retry'));assert.equal(calls,2);
});

test('rail thumbnails remain visible after URL release and eviction, including on reopen',async()=>{
  const script=await build({entryPoints:['src/settings-ux/risu-bindings.ts'],bundle:true,write:false,format:'iife',globalName:'Rail'});
  const browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
  try {
    const page=await browser.newPage();
    await page.setContent('<select id="nx-scope-char"><option value="0">A</option><option value="1">B</option><option value="2">A2</option><option value="3">Huge</option></select><div id="nx-risu-pick-tiles" style="height:600px;overflow:auto"></div>');
    await page.addScriptTag({content:script.outputFiles[0].text});
    await page.evaluate(()=>{
      window.stats={created:0,revoked:0,reads:{}};
      const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
      URL.createObjectURL=blob=>{stats.created++;return create(blob);};URL.revokeObjectURL=url=>{stats.revoked++;revoke(url);};
      window.risuai={getCurrentCharacterIndex:async()=>0,getDatabase:async()=>({characters:['a','b','a','huge'].map(image=>({image}))}),readImage:async path=>{
        stats.reads[path]=(stats.reads[path]||0)+1;
        const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
        return new Blob([png,new Uint8Array((path==='huge'?17:9)*1024*1024)],{type:'image/png'});
      }};
      return Rail.fillRisuTiles(document.getElementById('nx-risu-pick-tiles'));
    });
    const loaded=()=>page.waitForFunction(()=>{const imgs=[...document.querySelectorAll('#nx-risu-pick-tiles img')];return imgs.length===4&&imgs.every(i=>i.naturalWidth===1)&&stats.created===stats.revoked;});
    await loaded();
    assert.equal((await page.evaluate(()=>stats.reads)).a,1,'two simultaneous tiles share one host read');
    await page.evaluate(async()=>{
      const old=document.getElementById('nx-risu-pick-tiles'),next=old.cloneNode(false);old.replaceWith(next);
      await Rail.fillRisuTiles(next);
    });
    await loaded();
    const counts=await page.evaluate(()=>stats);
    assert.ok(counts.created>=8);assert.equal(counts.created,counts.revoked);
    assert.equal(counts.reads.huge,2,'oversized bytes are not cached between mounts');
  } finally {await browser.close();}
});
