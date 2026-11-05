import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';

import {
  characterRegions,
  comfyImageHoles,
  comfyRegionImageValues,
  comfyRegionValues,
  encodeMaskPng,
  pixelBox,
} from '../.test-build/comfy-regions.mjs';
import { buildComfyPlaceholderValues, buildComfyWorkflowFromTemplate } from '../.test-build/comfy-client.mjs';

/** Reads a 1-bit grayscale PNG back into rows of 0/1, checking every chunk CRC. */
function readMask(bytes) {
  const u8 = Buffer.from(bytes);
  assert.deepEqual([...u8.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let o = 8, w = 0, h = 0;
  const idat = [];
  while (o < u8.length) {
    const len = u8.readUInt32BE(o), type = u8.toString('latin1', o + 4, o + 8);
    const data = u8.subarray(o + 8, o + 8 + len);
    assert.equal(u8.readUInt32BE(o + 8 + len), crc32(u8.subarray(o + 4, o + 8 + len)) >>> 0, `${type} crc`);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [1, 0, 0, 0, 0], '1-bit grayscale');
    }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(w / 8);
  assert.equal(raw.length, (rowBytes + 1) * h);
  const at = (x, y) => (raw[y * (rowBytes + 1) + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
  return { w, h, at };
}

test('two characters side by side split the canvas at the midpoint', () => {
  const [a, b] = characterRegions([{ center_x: 0.3, center_y: 0.5 }, { center_x: 0.7, center_y: 0.5 }]);
  assert.deepEqual(a, { x: 0, y: 0, w: 0.5, h: 1 });
  assert.deepEqual(b, { x: 0.5, y: 0, w: 0.5, h: 1 });
});

test('regions tile the canvas: three across, and one above another', () => {
  const across = characterRegions([{ center_x: 0.1, center_y: 0.5 }, { center_x: 0.5, center_y: 0.5 }, { center_x: 0.9, center_y: 0.5 }]);
  assert.deepEqual(across.map(r => [r.x, Math.round(r.w * 100) / 100]), [[0, 0.3], [0.3, 0.4], [0.7, 0.3]]);
  const stacked = characterRegions([{ center_x: 0.5, center_y: 0.1 }, { center_x: 0.5, center_y: 0.9 }]);
  assert.deepEqual(stacked, [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }]);
});

test('one character, or two on the same point, get the whole canvas', () => {
  assert.deepEqual(characterRegions([{ center_x: 0.3, center_y: 0.3 }]), [{ x: 0, y: 0, w: 1, h: 1 }]);
  const same = characterRegions([{ center_x: 0.5, center_y: 0.5 }, { center_x: 0.5, center_y: 0.5 }]);
  assert.deepEqual(same, [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }]);
});

test('pixel boxes land on multiples of 8 and are never under 64', () => {
  assert.deepEqual(pixelBox({ x: 0.5, y: 0, w: 0.5, h: 1 }, 832, 1216), { x: 416, y: 0, w: 416, h: 1216 });
  const thin = pixelBox({ x: 0.98, y: 0, w: 0.02, h: 1 }, 832, 1216);
  assert.equal(thin.w, 64); assert.equal(thin.x + thin.w, 832);
  for (const v of Object.values(thin)) assert.equal(v % 8, 0);
});

test('placeholder numbers: present slots carry the box, empty slots are the whole canvas with _on 0', () => {
  const v = comfyRegionValues([{ center_x: 0.3, center_y: 0.5 }, { center_x: 0.7, center_y: 0.5 }], 832, 1216);
  assert.equal(v.char_count, 2);
  assert.deepEqual([v.char1_on, v.char1_x, v.char1_y, v.char1_w, v.char1_h], [1, 0, 0, 416, 1216]);
  assert.deepEqual([v.char2_on, v.char2_x, v.char2_w, v.char2_px, v.char2_pw], [1, 416, 416, 0.5, 0.5]);
  assert.deepEqual([v.char1_cx, v.char1_cy], [0.3, 0.5]);
  assert.deepEqual([v.char3_on, v.char3_x, v.char3_y, v.char3_w, v.char3_h, v.char3_pw, v.char3_ph], [0, 0, 0, 832, 1216, 1, 1]);
});

test('the mask PNG is white exactly inside the box', () => {
  const m = readMask(encodeMaskPng(100, 40, { x: 24, y: 8, w: 40, h: 16 }));
  assert.equal(m.w, 100); assert.equal(m.h, 40);
  for (let y = 0; y < 40; y += 1) {
    for (let x = 0; x < 100; x += 1) {
      const inside = x >= 24 && x < 64 && y >= 8 && y < 24;
      assert.equal(m.at(x, y), inside ? 1 : 0, `${x},${y}`);
    }
  }
  const black = readMask(encodeMaskPng(16, 16, null));
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) assert.equal(black.at(x, y), 0);
});

test('a full-size mask spans several stored deflate blocks and still decodes', () => {
  const m = readMask(encodeMaskPng(832, 1216, { x: 416, y: 0, w: 416, h: 1216 }));
  assert.equal(m.at(415, 600), 0); assert.equal(m.at(416, 600), 1); assert.equal(m.at(831, 1215), 1);
});

test('only the holes a workflow contains are found', () => {
  const holes = comfyImageHoles('{"a":"[[char1_mask]]","b":"[[ char3_ref ]]","c":"[[#char2_ref]]x[[/char2_ref]]","d":"[[vibe]]"}');
  assert.deepEqual([...holes.masks], [1]);
  assert.deepEqual([...holes.refs], [3]);
  assert.equal(holes.vibe, true);
  assert.equal(comfyImageHoles('{"a":"[[pos]]"}').vibe, false);
});

test('uploads: one mask per asked slot, a real reference when there is one, one shared black stand-in otherwise', async () => {
  const uploads = [];
  const upload = async (bytes, label) => { uploads.push({ label, bytes }); return `${label}.png`; };
  const ref = new Uint8Array(400).fill(7).buffer;
  const wf = JSON.stringify({ 1: { inputs: { image: '[[char1_mask]]' } }, 2: { inputs: { image: '[[char3_mask]]' } },
    3: { inputs: { image: '[[char1_ref]]' } }, 4: { inputs: { image: '[[char2_ref]]' } }, 5: { inputs: { image: '[[vibe]]' } } });
  const captions = [{ center_x: 0.3, center_y: 0.5 }, { center_x: 0.7, center_y: 0.5 }];
  const v = await comfyRegionImageValues(wf, captions, 832, 1216, { charRefs: [ref, null], refWeight: 0.8, vibeWeight: 0.4 }, upload);
  assert.deepEqual(uploads.map(u => u.label), ['char1-mask', 'char1-ref', 'blank', 'char3-mask']);
  assert.equal(v.char1_mask, 'char1-mask.png');
  assert.equal(v.char1_ref, 'char1-ref.png'); assert.equal(v.char1_ref_weight, 0.8);
  assert.equal(v.char2_ref, 'blank.png'); assert.equal(v.char2_ref_weight, 0);
  assert.equal(v.vibe, 'blank.png'); assert.equal(v.vibe_weight, 0);
  assert.equal(uploads[1].bytes, ref);
  const left = readMask(uploads[0].bytes);
  assert.equal(left.at(100, 600), 1); assert.equal(left.at(500, 600), 0);
  const empty = readMask(uploads[3].bytes);
  assert.equal(empty.w, 832); assert.equal(empty.at(100, 600), 0, 'a slot with no character covers nothing');
});

test('a workflow with no image holes uploads nothing', async () => {
  const uploads = [];
  const v = await comfyRegionImageValues('{"1":{"inputs":{"text":"[[pos]]"}}}', [{ center_x: 0.5 }], 832, 1216,
    { charRefs: [new Uint8Array(400).buffer], vibe: new Uint8Array(400).buffer, vibeWeight: 0.5 },
    async (b, l) => { uploads.push(l); return l; });
  assert.deepEqual(uploads, []);
  assert.equal(v.vibe_weight, 0.5);
});

test('region numbers reach a workflow as numbers', () => {
  const values = buildComfyPlaceholderValues({
    main: 'a', neg: '', seed: 1, nai: { width: 832, height: 1216 },
    captions: [{ prompt: 'girl', uc: '', center_x: 0.3, center_y: 0.5 }, { prompt: 'boy', uc: '', center_x: 0.7, center_y: 0.5 }],
  });
  const wf = buildComfyWorkflowFromTemplate(JSON.stringify({
    1: { class_type: 'CLIPTextEncode', inputs: { text: '[[pos]]' } },
    2: { class_type: 'ConditioningSetArea', inputs: { x: '[[char2_x]]', y: '[[char2_y]]', width: '[[char2_w]]', height: '[[char2_h]]', strength: '[[char2_on]]' } },
    3: { class_type: 'ConditioningSetAreaPercentage', inputs: { x: '[[char1_px]]', width: '[[char1_pw]]', strength: '[[char3_on]]' } },
  }), values);
  assert.deepEqual(wf[2].inputs, { x: 416, y: 0, width: 416, height: 1216, strength: 1 });
  assert.deepEqual(wf[3].inputs, { x: 0, width: 0.5, strength: 0 });
});
