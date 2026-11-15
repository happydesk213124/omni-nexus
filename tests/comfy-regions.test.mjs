import test from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';

import {
  characterRegions,
  comfyImageHoles,
  comfyRegionImageValues,
  comfyRegionValues,
  encodeMaskPng,
  applyConvertEdits,
  convertComfyWorkflow,
  convertMessages,
  mossBox,
  mossPrompt,
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

test('MOSS boxes reach past their region and keep head room when the region is full height', () => {
  assert.deepEqual(mossBox({ x: 0, y: 0, w: 0.5, h: 1 }), { x: 0, y: 0.05, w: 0.6, h: 0.95 });
  const top = mossBox({ x: 0, y: 0, w: 1, h: 0.5 });
  assert.deepEqual([top.y, top.h], [0, 0.6]);
});

test('MOSS prompt: boxes in centred pixels with positions on, plain characters with AI choice', () => {
  const people = [
    { center_x: 0.3, center_y: 0.5, positive: '1girl, smile' },
    { center_x: 0.7, center_y: 0.5, positive: '1boy' },
  ];
  const layout = JSON.parse(mossPrompt('library', people, true, 1000, 1000));
  assert.deepEqual(layout.summary, { caption: 'library' });
  assert.deepEqual(layout.items.map(i => [i.caption, i.bbox]), [['1girl, smile', [-450, -500, 500, 100]], ['1boy', [-450, -100, 500, 500]]]);
  assert.equal(layout.bbox_coord_space, 'abs_centralized');
  assert.equal(mossPrompt('library', people, false, 1000, 1000), 'library\n\nCharacter 1: 1girl, smile.\nCharacter 2: 1boy.');
});

test('MOSS prompt gives no boxes for one character, and skips characters whose tags went into the main prompt', () => {
  assert.equal(mossPrompt('park', [{ center_x: 0.5, center_y: 0.5, positive: '1girl' }], true, 1024, 1024), 'park\n\nCharacter 1: 1girl.');
  assert.equal(mossPrompt('park, 1girl', [{ center_x: 0.3, positive: '' }, { center_x: 0.7, positive: '1boy' }], true, 1024, 1024), 'park, 1girl\n\nCharacter 1: 1boy.');
  assert.equal(mossPrompt('park', [], true, 1024, 1024), 'park');
});

test('[[moss_prompt]] follows the AI choice flag through the placeholder table', () => {
  const nai = { width: 832, height: 1216 };
  const captions = [{ name: 'A', prompt: '1girl, {smile}', center_x: 0.3, center_y: 0.5 }, { name: 'B', prompt: '1boy', center_x: 0.7, center_y: 0.5 }];
  // No [[pos]] here: [[moss_prompt]] alone is a complete positive prompt.
  const wf = { 1: { class_type: 'CLIPTextEncode', inputs: { text: '[[moss_prompt]]' } } };
  const placed = buildComfyWorkflowFromTemplate(JSON.stringify(wf), buildComfyPlaceholderValues({ main: 'park', neg: '', captions, nai, seed: 1, useCoords: true }));
  assert.deepEqual(JSON.parse(placed[1].inputs.text).items.map(i => i.caption), ['1girl, (smile)', '1boy']);
  const free = buildComfyWorkflowFromTemplate(JSON.stringify(wf), buildComfyPlaceholderValues({ main: 'park', neg: '', captions, nai, seed: 1 }));
  assert.equal(free[1].inputs.text, 'park\n\nCharacter 1: 1girl, (smile).\nCharacter 2: 1boy.');
});

test('[[webp_quality]] and [[webp_lossless]] reach a save node as a number and a boolean', () => {
  const wf = { 1: { inputs: { text: '[[pos]]' } }, 2: { class_type: 'SaveAnimatedWEBP', inputs: { quality: '[[webp_quality]]', lossless: '[[webp_lossless]]' } } };
  const build = webp => buildComfyWorkflowFromTemplate(JSON.stringify(wf), buildComfyPlaceholderValues({ main: 'park', neg: '', captions: [], nai: {}, seed: 1, webp }))[2].inputs;
  assert.deepEqual(build({ quality: 75, lossless: true }), { quality: 75, lossless: true });
  assert.deepEqual(build(undefined), { quality: 90, lossless: false }, 'the defaults, for a preview drawn outside a shot');
  assert.deepEqual(build({ quality: 500, lossless: 'yes' }), { quality: 100, lossless: false });
});

const plainExport = () => ({
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } },
  2: { class_type: 'CLIPTextEncode', inputs: { text: '1girl, park', clip: ['1', 1] }, _meta: { title: '긍정' } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'lowres', clip: ['1', 1] } },
  4: { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216, batch_size: 1 } },
  5: { class_type: 'KSampler', inputs: { seed: 5, steps: 20, cfg: 6, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'mine' } },
});

test('convert: a plain export gets its prompts, size and a WebP save by the links alone, and nothing else changes', () => {
  const source = plainExport(), out = convertComfyWorkflow(source);
  assert.deepEqual(out.missing, []);
  assert.equal(out.workflow[2].inputs.text, '[[pos]]'); assert.equal(out.workflow[3].inputs.text, '[[neg]]');
  assert.deepEqual([out.workflow[4].inputs.width, out.workflow[4].inputs.height], ['[[width]]', '[[height]]']);
  assert.deepEqual(out.workflow[7], { class_type: 'SaveAnimatedWEBP', inputs: { images: ['6', 0], filename_prefix: 'mine', fps: 6, lossless: '[[webp_lossless]]', quality: '[[webp_quality]]', method: 'default' }, _meta: { title: 'WebP 저장 (대시보드의 WebP 품질 · 무손실)' } });
  assert.deepEqual(out.workflow[5], source[5], 'steps, cfg and the links stay the workflow itself');
  assert.equal(source[2].inputs.text, '1girl, park', 'the input is not changed');
  assert.equal(out.changes.length, 5);
  // The result is one Omni runs: the markers fill and the values are typed.
  const run = buildComfyWorkflowFromTemplate(JSON.stringify(out.workflow), buildComfyPlaceholderValues({ main: 'beach', neg: 'bad', captions: [], nai: { width: 1024, height: 1024 }, seed: 9, webp: { quality: 80 } }));
  assert.deepEqual([run[2].inputs.text, run[3].inputs.text, run[4].inputs.width, run[7].inputs.quality, run[7].inputs.lossless, run[5].inputs.seed], ['beach', 'bad', 1024, 80, false, 9]);
  // Converted again: nothing left to do.
  assert.deepEqual(convertComfyWorkflow(out.workflow).changes, []);
});

test('convert: MOSS takes [[moss_prompt]], a seed held by another node gets [[seed]], a preview becomes the save', () => {
  const wf = plainExport();
  wf[1] = { class_type: 'CLIPLoader', inputs: { clip_name: 'q.safetensors', type: 'moss_image' } };
  wf[8] = { class_type: 'PrimitiveInt', inputs: { value: 77 } }; wf[5].inputs.seed = ['8', 0];
  wf[7] = { class_type: 'PreviewImage', inputs: { images: ['6', 0] } };
  wf[9] = { class_type: 'PreviewImage', inputs: { images: ['1', 0] } };
  const out = convertComfyWorkflow(wf);
  assert.equal(out.workflow[2].inputs.text, '[[moss_prompt]]');
  assert.equal(out.workflow[8].inputs.value, '[[seed]]');
  assert.equal(out.workflow[7].class_type, 'SaveAnimatedWEBP', 'the preview of the finished picture');
  assert.equal(out.workflow[9].class_type, 'PreviewImage');
});

test('convert: a prompt assembled by other nodes is left to the model, whose edits are checked before they are applied', () => {
  const wf = plainExport();
  wf[10] = { class_type: 'PrimitiveStringMultiline', inputs: { value: 'a girl in a park' } };
  wf[11] = { class_type: 'StringFormat', inputs: { f_string: 'best, {a}', 'values.a': ['10', 0] } };
  wf[2].inputs.text = ['11', 0];
  const out = convertComfyWorkflow(wf);
  assert.deepEqual(out.missing, ['pos']);
  const asked = JSON.parse(convertMessages(out.workflow, out.missing)[1].content);
  assert.deepEqual(asked.find, ['pos']);
  assert.deepEqual(asked.workflow.find(row => row[0] === '2')[3].text, '<from node 11>');
  const done = applyConvertEdits(out, { edits: [['2', 'text', 'pos'], ['99', 'text', 'pos'], ['5', 'steps', 'neg'], ['10', 'value', 'pos'], ['10', 'value', 'pos']] });
  assert.equal(done.workflow[10].inputs.value, '[[pos]]', 'only the edit naming a literal string is taken, once');
  assert.deepEqual(done.workflow[2].inputs.text, ['11', 0]); assert.equal(done.workflow[5].inputs.steps, 20);
  assert.deepEqual(done.missing, []);
  assert.deepEqual(applyConvertEdits(convertComfyWorkflow(wf), 'nonsense').missing, ['pos']);
});
