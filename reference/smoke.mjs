/**
 * Runtime smoke test for native backend (getLocalPluginStorage + mocked nativeFetch).
 * Uses IndexedDB-style device store (JSON), not save-file pluginStorage / localStorage.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as identityCore from "../src/character-identity.js";
import * as settingsSchema from "../src/settings-schema.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const promptsDir = path.join(root, "prompts");

const prompts = {};
for (const key of ["tagger", "format", "appearance_inject", "lore_inject", "char_inject", "preprocess", "prefill", "preset_1"]) {
  const p = path.join(promptsDir, `${key}.txt`);
  prompts[key] = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

const storage = new Map();
const llmRequests = [];
const mockLlmReply = JSON.stringify({
  new_characters: [
    {
      name: "태양",
      aliases: ["태양", "Taeyang"],
      original: "",
      appearance: "boy, young adult, tall, black hair, short hair, messy hair, amber eyes",
      attire: "white shirt, black trousers",
    },
  ],
  scenes: [
    {
      place: "interior, workshop",
      shots: [
        {
          paragraph: 0,
          y_percent: 40,
          camera: "cowboy shot",
          situation: "1boy, solo",
          characters: [{ name: "태양", action: "holding hammer", expression: "serious" }],
        },
      ],
    },
  ],
});

// Minimal valid PNG (1x1)
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function zipStore(name, data) {
  const nameBytes = Buffer.from(name, "utf8");
  const local = Buffer.alloc(30 + nameBytes.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // store
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  nameBytes.copy(local, 30);
  Buffer.from(data).copy(local, 30 + nameBytes.length);
  // central directory + EOCD omitted — unzipFirstEntry only reads local header
  return local.buffer.slice(local.byteOffset, local.byteOffset + local.byteLength);
}

globalThis.__INLAY_NATIVE_PROMPTS__ = prompts;
globalThis.__INLAY_IDENTITY__ = identityCore;
globalThis.__INLAY_SETTINGS_SCHEMA__ = settingsSchema;
globalThis.risuai = {
  async getLocalPluginStorage() {
    return {
      async getItem(k) {
        return storage.has(k) ? storage.get(k) : null;
      },
      async setItem(k, v) {
        storage.set(k, v);
      },
      async removeItem(k) {
        storage.delete(k);
      },
    };
  },
  // Legacy save-file store (migration source) — empty in smoke.
  pluginStorage: {
    async getItem() {
      return null;
    },
    async setItem() {},
    async removeItem() {},
  },
  async nativeFetch(url, options = {}) {
    const u = String(url);
    if (u.includes("/chat/completions") || u.includes("openai") || u.includes("completions")) {
      try {
        const payload = typeof options.body === "string" ? JSON.parse(options.body) : options.body;
        llmRequests.push(payload && typeof payload === "object" ? payload : {});
      } catch (_) {
        llmRequests.push({});
      }
      return {
        status: 200,
        async json() {
          return { choices: [{ message: { content: mockLlmReply } }] };
        },
        async text() {
          return mockLlmReply;
        },
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      };
    }
    if (u.includes("generate-image") || u.includes("novelai.net/ai")) {
      const zip = zipStore("image.png", PNG);
      return {
        status: 200,
        async json() {
          return {};
        },
        async text() {
          return "";
        },
        async arrayBuffer() {
          return zip;
        },
      };
    }
    if (u.includes("subscription")) {
      return {
        status: 200,
        async json() {
          return { trainingStepsLeft: { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 0 }, perks: { unlimitedMaxPriority: true } };
        },
        async text() {
          return "";
        },
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      };
    }
    if (u.includes("autotagger")) {
      return {
        status: 200,
        async json() {
          return { tags: { "1girl": 0.9, "solo": 0.8 } };
        },
        async text() {
          return "";
        },
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      };
    }
    return { status: 404, async json() { return { error: "not mocked" }; }, async text() { return "not mocked"; }, async arrayBuffer() { return new ArrayBuffer(0); } };
  },
};

// URL.createObjectURL polyfill for Node
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => `blob:smoke-${Math.random().toString(16).slice(2)}`;
  URL.revokeObjectURL = () => {};
}
if (typeof Blob === "undefined") {
  globalThis.Blob = class Blob {
    constructor(parts) {
      this._parts = parts;
    }
  };
}

const backendCode = fs.readFileSync(path.join(root, "src", "native-backend.js"), "utf8");
vm.runInThisContext(backendCode, { filename: "native-backend.js" });

const N = globalThis.__INLAY_NATIVE__;
if (!N) throw new Error("native API missing");

async function waitForJob(jobId) {
  let result = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    result = await N.fetch(`/v1/jobs/${jobId}`, { method: "GET" });
    if (result.state === "done" || result.state === "error") break;
  }
  return result;
}

await N.ready();
const health = await N.fetch("/v1/health", { method: "GET" });
console.log("health", health?.ok, health?.health?.version || health?.health, health?.health?.storage);
if (health?.health?.storage !== "indexeddb") {
  console.error("SMOKE FAIL: health.storage expected indexeddb");
  process.exit(1);
}

await N.fetch("/v1/settings", {
  method: "PUT",
  body: {
    llm: { endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-test", api_key: "sk-test" },
    nai: { api_key: "pst-test", model: "nai-diffusion-4-5-full" },
    card: { power: true, image_max: 1 },
  },
});

const settings = await N.fetch("/v1/settings", { method: "GET" });
console.log("settings llm configured", settings?.settings?.llm?.api_key_configured, "nai", settings?.settings?.nai?.api_key_configured);

const exportedSettings = await N.fetch("/v1/settings/export", { method: "GET" });
const exportedObject = JSON.parse(exportedSettings.json);
if (exportedObject?.llm?.api_key || exportedObject?.nai?.api_key || exportedObject?.auth_token) {
  console.error("SMOKE FAIL: settings export leaked a secret");
  process.exit(1);
}

await N.fetch("/v1/characters", {
  method: "POST",
  body: {
    session_id: "sess_identity",
    characters: [
      { id: "jinwoo", name: "HAN JINWOO", aliases: ["HAN", "JINWOO", "HAN JINWOO"], appearance: "boy, black hair", attire: "suit" },
      { id: "mina", name: "HAN MINA", aliases: ["HAN", "MINA", "HAN MINA"], appearance: "girl, brown hair", attire: "dress" },
    ],
  },
});
const identityChars = await N.fetch("/v1/characters?session_id=sess_identity", { method: "GET" });
if (identityChars?.characters?.length !== 2) {
  console.error("SMOKE FAIL: shared surname characters were merged", identityChars?.characters);
  process.exit(1);
}
await N.fetch("/v1/characters/unify", {
  method: "POST",
  body: { target_session_id: "sess_identity", source_session_ids: [], include_target: true },
});
const identityAfterUnify = await N.fetch("/v1/characters?session_id=sess_identity", { method: "GET" });
if (identityAfterUnify?.characters?.length !== 2) {
  console.error("SMOKE FAIL: unify deleted a shared-surname character", identityAfterUnify?.characters);
  process.exit(1);
}

const unifiedRosterSession = "sess_roster_unified";
const rosterChatA = "sess_roster_chat_a";
const rosterChatB = "sess_roster_chat_b";
for (const [sessionId, id, appearance] of [
  [rosterChatA, "chat-a-nimeriel", "old chat A marker"],
  [rosterChatB, "chat-b-nimeriel", "old chat B marker"],
]) {
  await N.fetch("/v1/characters", {
    method: "POST",
    body: {
      session_id: sessionId,
      characters: [{
        id,
        name: "니메리엘",
        aliases: ["니메리엘", "Nimeriel"],
        appearance,
        attire: "white dress",
      }],
    },
  });
}

// Unified view edits patch existing roots only (no create-in-missing-chats).
await N.fetch("/v1/characters", {
  method: "POST",
  body: {
    session_id: unifiedRosterSession,
    root_session_ids: [rosterChatA, rosterChatB],
    characters: [{
      id: "view-nimeriel",
      name: "니메리엘",
      aliases: ["니메리엘", "Nimeriel"],
      appearance: "1girl, vivid violet eyes, long silver hair",
      attire: "blue dress",
    }],
  },
});

const chatAAfterPatch = await N.fetch(`/v1/characters?session_id=${rosterChatA}`, { method: "GET" });
const chatBAfterPatch = await N.fetch(`/v1/characters?session_id=${rosterChatB}`, { method: "GET" });
const chatANimeriel = chatAAfterPatch?.characters?.find((char) => char.name === "니메리엘");
const chatBNimeriel = chatBAfterPatch?.characters?.find((char) => char.name === "니메리엘");
if (
  !chatANimeriel?.tags?.includes("vivid violet eyes")
  || !chatBNimeriel?.tags?.includes("vivid violet eyes")
  || chatANimeriel?.id !== "chat-a-nimeriel"
  || chatBNimeriel?.id !== "chat-b-nimeriel"
) {
  console.error("SMOKE FAIL: unified view did not patch existing roots while preserving local ids", {
    chatANimeriel,
    chatBNimeriel,
  });
  process.exit(1);
}

// Chat C never had Nimeriel — patch must NOT create her there.
const rosterChatC = "sess_roster_chat_c";
await N.fetch("/v1/characters", {
  method: "POST",
  body: {
    session_id: rosterChatC,
    characters: [{
      id: "chat-c-other",
      name: "다른캐릭",
      aliases: ["다른캐릭"],
      appearance: "1girl, brown hair",
      attire: "coat",
    }],
  },
});
await N.fetch("/v1/characters", {
  method: "POST",
  body: {
    session_id: unifiedRosterSession,
    root_session_ids: [rosterChatA, rosterChatB, rosterChatC],
    character: {
      id: "view-nimeriel",
      name: "니메리엘",
      aliases: ["니메리엘", "Nimeriel"],
      appearance: "1girl, vivid violet eyes, long silver hair",
      attire: "blue dress",
    },
  },
});
const chatCAfter = await N.fetch(`/v1/characters?session_id=${rosterChatC}`, { method: "GET" });
if (chatCAfter?.characters?.some((char) => char.name === "니메리엘")) {
  console.error("SMOKE FAIL: patch created character in a chat that lacked it", chatCAfter?.characters);
  process.exit(1);
}

// Character that exists only in chat B — priority ON must surface her in the tagger roster.
await N.fetch("/v1/characters", {
  method: "POST",
  body: {
    session_id: rosterChatB,
    characters: [
      {
        ...chatBNimeriel,
        appearance: "1girl, vivid violet eyes, long silver hair",
      },
      {
        id: "chat-b-only",
        name: "챗비전용",
        aliases: ["챗비전용", "ChatBOnly"],
        appearance: "1girl, teal hair, violet eyes, chatB-only-roster",
        attire: "cloak",
      },
    ],
  },
});

const runRosterPromptJob = async ({ hash, sourceSessionIds = [], unifiedPriority = true }) => {
  await N.fetch("/v1/settings", {
    method: "POST",
    body: { card: { unified_chat_priority: !!unifiedPriority } },
  });
  const requestIndex = llmRequests.length;
  const started = await N.fetch("/v1/jobs/create", {
    method: "POST",
    body: {
      session_id: rosterChatA,
      source_session_ids: sourceSessionIds,
      unified_session_id: unifiedRosterSession,
      character_id: "char_roster",
      character_name: "로스터봇",
      chat_id: "chat_roster",
      chat_name: "로스터 테스트",
      assistant_text: "Nimeriel stands by the window.",
      message_index: hash.endsWith("on") ? 10 : 11,
      content_hash: hash,
      lorebook: [],
    },
  });
  const result = await waitForJob(started.job_id);
  const payload = llmRequests[requestIndex] || {};
  return {
    result,
    prompt: (payload.messages || []).map((message) => String(message?.content || "")).join("\n"),
  };
};

const unifiedPromptJob = await runRosterPromptJob({
  hash: "hash_roster_on",
  sourceSessionIds: [rosterChatA, rosterChatB],
  unifiedPriority: true,
});
if (
  unifiedPromptJob.result?.state !== "done"
  || !unifiedPromptJob.prompt.includes("teal hair")
  || !unifiedPromptJob.prompt.includes("챗비전용")
) {
  console.error("SMOKE FAIL: merged chat rosters were not used by tagger", unifiedPromptJob.result?.state, "promptLen=", (unifiedPromptJob.prompt || "").length);
  process.exit(1);
}

// Live chat A diverges; priority OFF must use A only (no chat-B-only character).
await N.fetch("/v1/characters", {
  method: "POST",
  body: {
    session_id: rosterChatA,
    characters: [{
      id: "chat-a-nimeriel",
      name: "니메리엘",
      aliases: ["니메리엘", "Nimeriel"],
      appearance: "1girl, vivid green eyes, short black hair",
      attire: "blue dress",
    }],
  },
});

const livePromptJob = await runRosterPromptJob({
  hash: "hash_roster_off",
  sourceSessionIds: [rosterChatA, rosterChatB],
  unifiedPriority: false,
});
if (
  livePromptJob.result?.state !== "done"
  || !livePromptJob.prompt.includes("vivid green eyes")
  || livePromptJob.prompt.includes("teal hair")
  || livePromptJob.prompt.includes("chatB-only-roster")
) {
  console.error("SMOKE FAIL: current-chat roster was not used when priority was off", livePromptJob.result?.state, livePromptJob.prompt.slice(0, 800));
  process.exit(1);
}

await N.fetch("/v1/characters", {
  method: "POST",
  body: {
    session_id: unifiedRosterSession,
    root_session_ids: [rosterChatA, rosterChatB],
    characters: [],
  },
});
for (const sessionId of [rosterChatA, rosterChatB]) {
  const payload = await N.fetch(`/v1/characters?session_id=${sessionId}`, { method: "GET" });
  if (payload?.characters?.length) {
    console.error("SMOKE FAIL: unified view prune did not clear root chats", sessionId, payload.characters);
    process.exit(1);
  }
}

const created = await N.fetch("/v1/jobs/create", {
  method: "POST",
  body: {
    session_id: "sess_smoke",
    character_id: "char_smoke",
    character_name: "스모크봇",
    chat_id: "chat_smoke",
    chat_name: "테스트채팅",
    assistant_text: "태양이 망치를 들었다.",
    message_index: 1,
    content_hash: "hash_smoke",
    lorebook: [],
  },
});
console.log("job create", created?.job_id, created?.job_state);

const jobId = created.job_id;
const done = await waitForJob(jobId);
console.log("job state", done?.state, "cards", done?.result?.cards?.length, "err", done?.error?.slice?.(0, 120) || done?.error);
console.log("job debug last_stage", done?.debug?.last_stage, "events", done?.debug?.events?.length);

const debug = await N.fetch("/v1/debug", { method: "GET" });
console.log("debug stages", Object.keys(debug?.by_stage || {}).slice(0, 12).join(","), "errors", debug?.errors?.length);
if (!debug?.events?.length) {
  console.error("SMOKE FAIL: /v1/debug empty");
  process.exit(1);
}

if (done?.state !== "done") {
  console.error("SMOKE FAIL: job did not complete");
  process.exit(1);
}

const gallery = await N.fetch("/v1/gallery?session_id=sess_smoke&limit=10", { method: "GET" });
const imgUrl = String(gallery?.items?.[0]?.image_url || "");
console.log("gallery items", gallery?.items?.length, "image_url", imgUrl.slice(0, 48));
if (!imgUrl.startsWith("data:image/png;base64,")) {
  console.error("SMOKE FAIL: expected data:image/png URL (no backend), got", imgUrl.slice(0, 80));
  process.exit(1);
}
const resolved = String(N.resolveImageUrl?.(gallery.items[0]) || "");
if (!resolved.startsWith("data:image/png;base64,")) {
  console.error("SMOKE FAIL: resolveImageUrl should return data URL");
  process.exit(1);
}

const chars = await N.fetch("/v1/characters?session_id=sess_smoke", { method: "GET" });
console.log("characters", chars?.characters?.map((c) => c.name));

const explore = await N.fetch("/v1/gallery/explore?limit=50", { method: "GET" });
console.log("explore", explore?.total, "folders", explore?.folders?.length, "storage", explore?.storage);
if (explore?.storage !== "indexeddb") {
  console.error("SMOKE FAIL: explore.storage expected indexeddb");
  process.exit(1);
}
if (!explore?.items?.[0]?.character_name && !explore?.folders?.[0]?.character_name) {
  console.error("SMOKE FAIL: explorer missing character_name metadata");
  process.exit(1);
}
const health2 = await N.fetch("/v1/health", { method: "GET" });
if (health2?.health?.storage !== "indexeddb") {
  console.error("SMOKE FAIL: health.storage expected indexeddb", health2?.health);
  process.exit(1);
}

const cardId = gallery.items[0].id;
const tags = await N.fetch(`/v1/cards/${cardId}/tags`, {
  method: "POST",
  body: { main_prompt: "EDITOR-ONLY-MARKER", negative_prompt: "editor negative", characters: [] },
});
console.log("tags ok", tags?.ok, tags?.card?.main_prompt?.slice(0, 30));

const reroll = await N.fetch(`/v1/cards/${cardId}/reroll`, { method: "POST", body: { mode: "nai" } });
console.log("reroll ok", reroll?.ok, "new", reroll?.card?.id?.slice(0, 8), "replaced", String(reroll?.replaced || "").slice(0, 8));
if (!reroll?.ok || !reroll?.card?.main_prompt) {
  console.error("SMOKE FAIL: ordinary reroll stopped rebuilding its generation payload", reroll?.card);
  process.exit(1);
}

const editedCardId = reroll.card.id;
await N.fetch(`/v1/cards/${editedCardId}/tags`, {
  method: "POST",
  body: { main_prompt: "", negative_prompt: "", characters: [] },
});
const editedReroll = await N.fetch(`/v1/cards/${editedCardId}/reroll`, {
  method: "POST",
  body: {
    mode: "nai",
    overrides: { main_prompt: "", negative_prompt: "", characters: [] },
  },
});
if (
  !editedReroll?.ok
  || editedReroll?.card?.main_prompt !== ""
  || editedReroll?.card?.negative_prompt !== ""
  || editedReroll?.card?.characters?.length !== 0
) {
  console.error("SMOKE FAIL: shot-edit reroll resurrected cleared setup/characters", editedReroll?.card);
  process.exit(1);
}

const llmTest = await N.fetch("/v1/models/test", { method: "POST", body: {} });
const naiTest = await N.fetch("/v1/nai/test", { method: "POST", body: {} });
console.log("llm test", llmTest?.ok, "nai test", naiTest?.ok);

const cardSave = await N.fetch("/v1/settings", {
  method: "PUT",
  body: {
    card: {
      mode: "illustration",
      image_min: 1,
      image_max: 2,
      character_max: 4,
      presets: [
        { id: "p1", name: "테스트프리셋", positive: "best quality", negative: "lowres" },
      ],
      active_preset_id: "p1",
      custom_pos: "best quality",
      custom_neg: "lowres",
    },
  },
});
console.log("card save ok", cardSave?.ok, "presets", cardSave?.settings?.card?.presets?.length, cardSave?.settings?.card?.presets?.[0]?.name);

// Simulate reload
globalThis.__INLAY_NATIVE__ = undefined;
// Re-init by re-running would be heavy; instead clear nexus via fresh fetch after poking storage
const reloaded = await N.fetch("/v1/settings", { method: "GET" });
console.log("card reload presets", reloaded?.settings?.card?.presets?.length, reloaded?.settings?.card?.active_preset_id, storage.has("inx_native_settings"));

if (!cardSave?.settings?.card?.presets?.length) {
  console.error("SMOKE FAIL: card presets not saved");
  process.exit(1);
}
if (!storage.has("inx_native_settings")) {
  console.error("SMOKE FAIL: inx_native_settings missing from getLocalPluginStorage");
  process.exit(1);
}

console.log("SMOKE PASS");
