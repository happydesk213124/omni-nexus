/**
 * Deterministic mock RisuAI host for the parity harness.
 *
 * Both the legacy backend and the 2.0 backend are executed against this exact
 * host, so any difference in the recorded transcript is a real behaviour change.
 *
 * Determinism strategy:
 *   - `Math.random` and `crypto.*` are seeded, so every generated id is reproducible.
 *   - `Date.now` keeps advancing (timeouts must still work) but starts from a fixed
 *     epoch; the comparer normalises the residual jitter.
 */
import fs from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';

export const FIXED_EPOCH = 1_760_000_000_000;

const PROMPT_KEYS = [
  'author_note', 'tagger', 'format', 'prefill', 'preprocess',
  'preset_1', 'lore_inject', 'char_inject', 'appearance_inject', 'autotag',
  'command_reroll',
];

/** 1x1 PNG. */
export const PNG_1X1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** Same pixels as PNG_1X1 plus NovelAI Comment/Source so reroll can replay the file. */
const NAI_COMMENT = {
  prompt: 'parity cafe, night',
  uc: 'lowres, bad quality',
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5,
  sampler: 'k_euler_ancestral',
  noise_schedule: 'karras',
  model: 'nai-diffusion-4-5-full',
  v4_prompt: {
    caption: {
      base_caption: 'parity cafe, night',
      char_captions: [{ char_caption: 'boy, black hair', centers: [{ x: 0.5, y: 0.5 }] }],
    },
  },
  v4_negative_prompt: {
    caption: {
      base_caption: 'lowres, bad quality',
      char_captions: [{ char_caption: '' }],
    },
  },
};
const NAI_TEXT_SOURCE = Buffer.from('Source\0NAI Diffusion V4.5 Full', 'latin1');
const NAI_TEXT_COMMENT = Buffer.from(`Comment\0${JSON.stringify(NAI_COMMENT)}`, 'latin1');
const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
function pngChunksBeforeIend(buf) {
  let offset = 8;
  let end = 8;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('latin1');
    if (type === 'IEND' || length > 1_000_000 || offset + 12 + length > buf.length) break;
    end = offset + 12 + length;
    offset = end;
  }
  return buf.subarray(0, end);
}
export const PNG_NAI_1X1 = Buffer.concat([
  pngChunksBeforeIend(Buffer.from(PNG_1X1)),
  pngChunk('tEXt', NAI_TEXT_SOURCE),
  pngChunk('tEXt', NAI_TEXT_COMMENT),
  PNG_IEND,
]);

/** mulberry32 — small, fast, reproducible. */
const makeRng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Minimal stored (uncompressed) ZIP holding one file — matches NAI's response shape. */
export const zipStore = (name, data) => {
  const nameBytes = Buffer.from(name, 'utf8');
  const body = Buffer.from(data);
  const local = Buffer.alloc(30 + nameBytes.length + body.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // stored, no compression
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  nameBytes.copy(local, 30);
  body.copy(local, 30 + nameBytes.length);
  return local.buffer.slice(local.byteOffset, local.byteOffset + local.byteLength);
};

const jsonResponse = (status, payload) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: () => null },
  async json() { return payload; },
  async text() { return JSON.stringify(payload); },
  async arrayBuffer() { return new ArrayBuffer(0); },
});

const bytesResponse = (status, buffer) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-length' ? String(buffer.byteLength) : null) },
  async json() { return {}; },
  async text() { return ''; },
  async arrayBuffer() { return buffer; },
});

export const DEFAULT_LLM_REPLY = JSON.stringify({
  new_characters: [
    {
      name: '태양',
      aliases: ['태양', 'Taeyang'],
      original: '',
      appearance: 'boy, young adult, tall, black hair, short hair, messy hair, amber eyes',
      attire: 'white shirt, black trousers',
    },
  ],
  scenes: [
    {
      place: 'interior, workshop',
      shots: [
        {
          paragraph: 0,
          y_percent: 40,
          camera: 'cowboy shot',
          situation: '1boy, solo',
          characters: [{ name: '태양', action: 'holding hammer', expression: 'serious' }],
        },
      ],
    },
  ],
});

const AUTOTAG_REPLY = JSON.stringify({
  appearance: '1girl, long silver hair, violet eyes',
  attire: 'blue dress',
  accessories: 'silver earrings',
});

/**
 * Installs the deterministic host onto `globalThis`.
 * @returns handles used by the scenario to assert on outbound traffic.
 */
export function installHost({ promptsDir, seed = 0x5eed }) {
  const rng = makeRng(seed);
  const storage = new Map();
  const legacyStorage = new Map();
  const llmRequests = [];
  const naiRequests = [];
  const comfyRequests = [];
  const unmocked = [];
  let generationGate = null;
  const pauseGeneration = () => {
    let enter, release;
    const started = new Promise(resolve => { enter = resolve; });
    const ready = new Promise(resolve => { release = resolve; });
    generationGate = { enter, ready };
    return { started, release: () => { generationGate = null; release(); } };
  };


  // --- deterministic randomness -------------------------------------------
  Math.random = rng;

  let uuidCounter = 0;
  const hex = (n) => Math.floor(rng() * 16 ** n).toString(16).padStart(n, '0');
  const cryptoStub = {
    randomUUID: () => {
      uuidCounter += 1;
      return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(8)}${hex(4)}`;
    },
    getRandomValues: (arr) => {
      for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(rng() * 256);
      return arr;
    },
    subtle: globalThis.crypto?.subtle,
  };
  Object.defineProperty(globalThis, 'crypto', { value: cryptoStub, configurable: true, writable: true });
  void uuidCounter;

  // --- clock ---------------------------------------------------------------
  const bootReal = Date.now();
  const realNow = Date.now;
  Date.now = () => FIXED_EPOCH + (realNow.call(Date) - bootReal);

  // --- prompt pack ---------------------------------------------------------
  // Stands in for what the *built* plugin embeds, so the parity runs compare
  // backends on equal footing. `tools/smoke.mjs` deliberately omits `promptsDir`
  // so that the bundle has to supply its own — the one thing this cannot prove.
  const prompts = {};
  if (promptsDir) {
    for (const key of PROMPT_KEYS) {
      const file = path.join(promptsDir, `${key}.txt`);
      prompts[key] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    }
    globalThis.__INLAY_NATIVE_PROMPTS__ = prompts;
  }

  // --- browser bits Node lacks --------------------------------------------
  if (typeof globalThis.Blob === 'undefined') {
    globalThis.Blob = class Blob {
      constructor(parts) { this._parts = parts; }
    };
  }
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => `blob:parity-${hex(8)}`;
    URL.revokeObjectURL = () => {};
  }
  // No canvas in Node: WebP re-encoding must fall back to the original PNG path
  // in BOTH backends, which keeps the comparison fair.
  delete globalThis.document;
  delete globalThis.OffscreenCanvas;
  delete globalThis.createImageBitmap;

  // --- risuai host ---------------------------------------------------------
  let llmReply = DEFAULT_LLM_REPLY;
  const setLlmReply = (value) => { llmReply = value; };

  const nativeFetch = async (url, options = {}) => {
    const u = String(url);
    const readBody = () => {
      try {
        return typeof options.body === 'string' ? JSON.parse(options.body) : (options.body ?? {});
      } catch {
        return {};
      }
    };

    if (u.includes('oauth2.googleapis.com')) {
      return jsonResponse(200, { access_token: 'parity-google-token', expires_in: 3600 });
    }
    if (u.includes('/messages')) { // Anthropic
      llmRequests.push(readBody());
      return jsonResponse(200, { content: [{ type: 'text', text: llmReply }] });
    }
    if (u.includes('completions') || u.includes('generateContent')) {
      const body = readBody();
      llmRequests.push(body);
      const isVision = JSON.stringify(body).includes('data:image');
      return jsonResponse(200, {
        choices: [{ message: { content: isVision ? AUTOTAG_REPLY : llmReply } }],
      });
    }
    if (u.includes('encode-vibe')) {
      naiRequests.push({ kind: 'encode-vibe', body: readBody() });
      // NAI returns raw bytes here, not JSON.
      return bytesResponse(200, Uint8Array.from({ length: 64 }, (_, i) => (i * 7) & 0xff).buffer);
    }
    if (u.includes('generate-image') || u.includes('novelai.net/ai')) {
      naiRequests.push({ kind: 'generate', body: readBody() });
      if (generationGate) { generationGate.enter(); await generationGate.ready; }
      return bytesResponse(200, zipStore('image_0.png', PNG_NAI_1X1));
    }
    if (u.includes('subscription')) {
      return jsonResponse(200, {
        trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 25 },
        perks: { unlimitedMaxPriority: true },
      });
    }
    if (u.includes('/user/data')) {
      return jsonResponse(200, {});
    }
    if (u.includes('/user/priority')) {
      // 2.4.6: when /user/data has no account-shaped body, quota falls back here.
      return jsonResponse(200, {});
    }
    if (u.includes('/prompt')) { // ComfyUI submit
      comfyRequests.push({ kind: 'prompt', body: readBody() });
      return jsonResponse(200, { prompt_id: 'parity-comfy-1' });
    }
    if (u.includes('/history/')) {
      return jsonResponse(200, {
        'parity-comfy-1': {
          status: { completed: true },
          outputs: { 9: { images: [{ filename: 'p.png', subfolder: '', type: 'output' }] } },
        },
      });
    }
    if (u.includes('/view')) {
      return bytesResponse(200, PNG_1X1.buffer.slice(0));
    }
    if (u.includes('/system_stats')) {
      return jsonResponse(200, { system: { comfyui_version: 'parity' } });
    }

    unmocked.push(u);
    return jsonResponse(404, { error: 'not mocked' });
  };

  // Objective cost counters: persistence volume is the backend's dominant
  // runtime cost, so the harness measures it rather than guessing.
  // `readsByKey` exists so a caller can tell *which* keys were read, not just how
  // many. `tools/bench-gallery.mjs` uses it to count `inx_nximg_*` reads, which is
  // exactly the number of PNGs that were decoded.
  const perf = { writes: 0, writtenBytes: 0, reads: 0, byKey: new Map(), readsByKey: new Map() };
  const chargeRead = (key) => {
    perf.reads += 1;
    perf.readsByKey.set(key, (perf.readsByKey.get(key) ?? 0) + 1);
  };
  const chargeWrite = (key, value) => {
    perf.writes += 1;
    const bytes = typeof value === 'string'
      ? value.length
      : JSON.stringify(value ?? null).length;
    perf.writtenBytes += bytes;
    const prev = perf.byKey.get(key) ?? { writes: 0, bytes: 0 };
    perf.byKey.set(key, { writes: prev.writes + 1, bytes: prev.bytes + bytes });
  };

  const assetFiles = new Map();
  let assetSeq = 0;
  const fixture = fs.readFileSync(new URL('./scenario.mjs', import.meta.url), 'utf8');
  const ids=['smoke-character-save',...new Set([...fixture.matchAll(/\b((?:sess_|char_)[a-zA-Z0-9_]+)/g)].map(m=>m[1]))];
  const risuDb = { modules: [], enabledModules: [], characters: ids.map(chaId=>({chaId,name:chaId,additionalAssets:[],globalLore:[],chats:[]})) };

  // Jobs must target real chats now that continuity notes live in chat lore.
  // Keep these fixture identities aligned with the explicit create requests.
  for (const [characterId, chatIds] of [
    ['char_main', ['chat_main']],
    ['char_folder', ['chat_folder']],
    ['char_style', ['chat_style', 'chat_first_simple', 'chat_speech']],
  ]) {
    const character = risuDb.characters.find(row => row.chaId === characterId);
    if (!character) throw new Error(`Missing parity character: ${characterId}`);
    character.chats = chatIds.map(id => ({id, message:[], localLore:[]}));
  }

  risuDb.characters.push({chaId:'note-fixture',name:'note-fixture',additionalAssets:[],globalLore:[],chats:[{id:'note-chat',message:[],localLore:[]}]});
  globalThis.risuai = {
    async getCurrentCharacterIndex(){return 0;},
    async getLocalPluginStorage() {
      return {
        async getItem(k) { chargeRead(k); return storage.has(k) ? storage.get(k) : null; },
        async setItem(k, v) { chargeWrite(k, v); storage.set(k, v); },
        async removeItem(k) { storage.delete(k); },
      };
    },
    pluginStorage: {
      async getItem(k) { return legacyStorage.has(k) ? legacyStorage.get(k) : null; },
      async setItem(k, v) { legacyStorage.set(k, v); },
      async removeItem(k) { legacyStorage.delete(k); },
    },
    async getChatFromIndex(i,j) {return structuredClone(risuDb.characters[i].chats[j]);},
    async setChatToIndex(i,j,chat) {risuDb.characters[i].chats[j]=structuredClone(chat);},
    async getCharacterFromIndex(index) { return structuredClone(risuDb.characters[index]); },
    async setCharacterToIndex(index, char) { risuDb.characters[index]=structuredClone(char); },
    async getDatabase() {
      return structuredClone(risuDb);
    },
    async setDatabase(next) {
      if (next && typeof next === 'object') {
        if ('modules' in next) risuDb.modules = structuredClone(next.modules) || [];
        if ('enabledModules' in next) risuDb.enabledModules = structuredClone(next.enabledModules) || [];
      }
    },
    async saveAsset(data) {
      assetSeq += 1;
      const path = `assets/parity-shot-${assetSeq}.bin`;
      if (data instanceof ArrayBuffer) assetFiles.set(path, new Uint8Array(data));
      else if (data instanceof Uint8Array) assetFiles.set(path, Uint8Array.from(data));
      else if (data && typeof data === 'object' && typeof data.byteLength === 'number') {
        assetFiles.set(path, Uint8Array.from(data));
      } else {
        assetFiles.set(path, new Uint8Array());
      }
      return path;
    },
    async readImage(path) {
      const bytes = assetFiles.get(path);
      if (!bytes) throw new Error('missing asset');
      return bytes;
    },
    nativeFetch,
    async runLLMModel({ messages }) {
      llmRequests.push({ via: 'risu', messages });
      return { success: true, content: llmReply };
    },
  };

  return { pauseGeneration, storage, legacyStorage, llmRequests, naiRequests, comfyRequests, unmocked, prompts, setLlmReply, perf };
}
