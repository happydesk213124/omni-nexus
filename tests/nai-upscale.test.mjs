import test from 'node:test';
import assert from 'node:assert/strict';
import { png } from './fixtures/upscale-image.mjs';
import { installHost, PNG_NAI_1X1, zipStore } from '../tools/parity/host.mjs';
import { imageDimensions, upscaleAnlas, webpQualityPercent, NAI_SIZE_PRESETS } from '../.test-build/nai-image-output.mjs';
import { upscaleNaiImage, generateT2i, upscaleImage } from '../.test-build/nai-upscale.mjs';


const buffer = bytes => bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);

test('official current presets, costs and quality limits',()=>{
  assert.deepEqual(NAI_SIZE_PRESETS.Large,[[1536,1024],[1024,1536],[1472,1472]]);
  assert.deepEqual(NAI_SIZE_PRESETS.Wallpaper,[[1920,1088],[1088,1920]]);
  assert.deepEqual([upscaleAnlas(832,1216),upscaleAnlas(1024,1536),upscaleAnlas(1920,1088),upscaleAnlas(2048,1536),upscaleAnlas(2048,2048),upscaleAnlas(0,1)],[1,2,3,4,0,0]);
  assert.deepEqual([undefined,'',NaN,0,73,101].map(webpQualityPercent),[90,90,90,1,73,100]);
  assert.deepEqual(imageDimensions(png(2,3)),{width:2,height:3});
  assert.deepEqual(imageDimensions(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64')),{width:1,height:1});
  assert.equal(imageDimensions(new Uint8Array(4)),null);
});

test('dedicated paid endpoint uses current official payload and shares generation token lane',async()=>{
  installHost({promptsDir:'prompts'});
  const calls=[]; let active=0,peak=0;
  risuai.nativeFetch=async(url,opts)=>{
    calls.push({url,body:JSON.parse(opts.body)});peak=Math.max(peak,++active);
    await new Promise(resolve=>setTimeout(resolve,10));active--;
    return new Response(zipStore('image.png',url.endsWith('/upscale')?png(2,2):PNG_NAI_1X1));
  };
  const [out]=await Promise.all([
    upscaleNaiImage('test',buffer(PNG_NAI_1X1)),
    generateT2i('test',{prompt:'test',width:832,height:1216,seed:1,model:'nai-diffusion-5-full'},'https://image.novelai.net/ai/generate-image'),
  ]);
  assert.equal(peak,1);
  assert.equal(calls[0].url,'https://image.novelai.net/ai/upscale');
  assert.deepEqual(Object.keys(calls[0].body).sort(),['declared_blur_sigma','image','model']);
  assert.equal(calls[0].body.model,'nai-diffusion-5-curated');
  assert.equal(calls[0].body.declared_blur_sigma,0);
  assert.deepEqual(Buffer.from(calls[0].body.image,'base64'),Buffer.from(PNG_NAI_1X1));
  assert.deepEqual(imageDimensions(out),{width:2,height:2});
});

test('failed paid request is not retried and malformed output never replaces original',async()=>{
  installHost({promptsDir:'prompts'});
  let calls=0;
  risuai.nativeFetch=async()=>{calls++;return new Response('Resource exhausted',{status:429});};
  const source=buffer(PNG_NAI_1X1),copy=Buffer.from(source);
  await assert.rejects(upscaleImage(source,'test'),/429/);assert.equal(calls,1);
  assert.deepEqual(Buffer.from(source),copy);
  risuai.nativeFetch=async()=>new Response(zipStore('image.png',PNG_NAI_1X1));
  await assert.rejects(upscaleImage(source,'test'),/해상도/);
});
