import test from "node:test";
import assert from "node:assert/strict";

import { foldCharacterUpsert, matchCharactersInText, mergeSessionAndGlobalRoster, normalizeCharacterRecord, pickUnifiedWinners, scanLinkedChatsForRosterMerge } from "../.test-build/roster-merge.mjs";

function helpers() {
  const key = (v) => String(v || "").trim().toLowerCase();
  return {
    hasAppearance: (c) => !!String(c?.appearance || "").trim(),
    resolve: (name, list) => (list || []).find((c) => key(c.name) === key(name)) || null,
    aliasKeys: (c) => new Set([key(c?.name)].filter(Boolean)),
    normalizeName: key,
    fullTags: (c) => [c?.appearance, c?.attire, c?.accessories].filter(Boolean).join(", "),
    clean: (v) => String(v || "").trim(),
    globalScope: "__global__",
  };
}

test("attire-only session overlay does not rewrite filled global wear", () => {
  const global = [{
    name: "Alice",
    appearance: "long hair, blue eyes",
    attire: "dress",
    accessories: "",
    scope: "__global__",
  }];
  const session = [{
    name: "Alice",
    appearance: "",
    attire: "school uniform",
    accessories: "ribbon",
  }];
  const merged = mergeSessionAndGlobalRoster(session, global, helpers());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].appearance, "long hair, blue eyes");
  assert.equal(merged[0].attire, "dress");
  assert.equal(merged[0].accessories, "");
  assert.ok(helpers().hasAppearance(merged[0]));
});

test("empty session without global stays incomplete", () => {
  const session = [{ name: "Bob", appearance: "", attire: "" }];
  const merged = mergeSessionAndGlobalRoster(session, [], helpers());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Bob");
  assert.equal(helpers().hasAppearance(merged[0]), false);
});

test("empty session does not replace a filled global with blank row", () => {
  const global = [{ name: "Char", appearance: "silver hair", attire: "coat", accessories: "" }];
  const session = [{ name: "Char", appearance: "", attire: "hoodie", accessories: "" }];
  const merged = mergeSessionAndGlobalRoster(session, global, helpers());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].appearance, "silver hair");
  assert.equal(merged[0].attire, "coat");
  assert.notEqual(merged[0].appearance, "");
});

test("session wear_state overlays onto filled global look", () => {
  const global = [{ name: "Char", appearance: "silver hair", attire: "coat", accessories: "" }];
  const session = [{ name: "Char", appearance: "", attire: "hoodie", wear_state: "topless" }];
  const merged = mergeSessionAndGlobalRoster(session, global, helpers());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].appearance, "silver hair");
  assert.equal(merged[0].attire, "coat");
  assert.equal(merged[0].wear_state, "topless");
});

test("normalizeCharacterRecord keeps user attire buckets (no save-time split)", () => {
  const rec = normalizeCharacterRecord({
    name: "보민",
    appearance: "black hair, boy",
    attire: "2.1::single bare shoulder::, white shirt",
    accessories: "earrings",
  });
  assert.equal(rec.appearance, "black hair, boy");
  assert.match(rec.attire, /bare shoulder/);
  assert.match(rec.attire, /white shirt/);
  assert.equal(rec.accessories, "earrings");
  assert.equal(rec.appearance.includes("bare shoulder"), false);
});

test("legacy flat tags dump into appearance without splitting", () => {
  const rec = normalizeCharacterRecord({
    name: "Old",
    tags: "black hair, white shirt, sword",
  });
  assert.equal(rec.appearance, "black hair, white shirt, sword");
  assert.equal(rec.attire, "");
  assert.equal(rec.accessories, "");
});

function omittedLooks() {
  return {
    appearance: false,
    attire: false,
    bottoms: false,
    accessories: false,
    original: false,
    surname: false,
    given_name: false,
    surname_variants: false,
    given_name_variants: false,
    costumes: false,
    active_costume: false,
    wear_state: true,
    attire_locked: false,
    bottoms_locked: false,
    accessories_locked: false,
    priority: false,
  };
}

test("foldCharacterUpsert keeps appearance when payload omits it", () => {
  const base = normalizeCharacterRecord({
    id: "han",
    name: "Han",
    appearance: "black hair, brown eyes",
    attire: "coat",
  });
  const incoming = normalizeCharacterRecord({
    id: "han",
    name: "Han",
    wear_state: "topless",
  });
  const folded = foldCharacterUpsert(base, incoming, omittedLooks());
  assert.equal(folded.appearance, "black hair, brown eyes");
  assert.equal(folded.attire, "coat");
  assert.equal(folded.wear_state, "topless");
});

test("foldCharacterUpsert keeps the typed name and priority", () => {
  const base = normalizeCharacterRecord({
    id: "han",
    name: "Han",
    priority: 5,
    appearance: "black hair",
  });
  const incoming = normalizeCharacterRecord({
    id: "han",
    name: "한결",
    priority: 0,
    appearance: "black hair",
  });
  const folded = foldCharacterUpsert(base, incoming, { ...omittedLooks(), appearance: true, wear_state: false, priority: true });
  assert.equal(folded.name, "한결");
  assert.equal(folded.priority, 0);
});

test("foldCharacterUpsert does not zero priority when the key is omitted", () => {
  const base = normalizeCharacterRecord({
    id: "han",
    name: "Han",
    priority: 5,
    appearance: "black hair",
  });
  const incoming = normalizeCharacterRecord({
    id: "han",
    name: "Han",
    wear_state: "topless",
  });
  const folded = foldCharacterUpsert(base, incoming, omittedLooks());
  assert.equal(folded.priority, 5);
});

test("foldCharacterUpsert still clears appearance when the key is present", () => {
  const base = normalizeCharacterRecord({
    id: "han",
    name: "Han",
    appearance: "black hair",
  });
  const incoming = normalizeCharacterRecord({
    id: "han",
    name: "Han",
    appearance: "",
  });
  const folded = foldCharacterUpsert(base, incoming, { ...omittedLooks(), appearance: true, wear_state: false });
  assert.equal(folded.appearance, "");
});

test("pickUnifiedWinners keeps the higher-priority row as-is", () => {
  const winners = pickUnifiedWinners([
    { name: "민희", appearance: "chat2 look", attire: "dress", priority: 1, updated_at: 200, id: "b", scope: "chat2" },
    { name: "민희", appearance: "chat1 look", attire: "shirt", priority: 5, updated_at: 10, id: "a", scope: "chat1" },
  ]);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].appearance, "chat1 look");
  assert.equal(winners[0].attire, "shirt");
  assert.equal(winners[0].scope, "chat1");
});

test("pickUnifiedWinners uses newer updated_at when priority ties", () => {
  const winners = pickUnifiedWinners([
    { name: "민희", appearance: "old", priority: 1, updated_at: 10, id: "a" },
    { name: "민희", appearance: "new", priority: 1, updated_at: 90, id: "b" },
  ]);
  assert.equal(winners[0].appearance, "new");
});

test("pickUnifiedWinners does not fold loser looks into the winner", () => {
  const winners = pickUnifiedWinners([
    { name: "민희", appearance: "short hair", attire: "", priority: 9, id: "a" },
    { name: "민희", appearance: "long hair", attire: "kimono", priority: 1, id: "b" },
  ]);
  assert.equal(winners[0].appearance, "short hair");
  assert.equal(winners[0].attire, "");
});

test("pickUnifiedWinners prefers a filled look over a higher-priority empty row", () => {
  const winners = pickUnifiedWinners([
    { name: "민희", appearance: "", attire: "", priority: 99, updated_at: 900, id: "empty", scope: "other" },
    { name: "민희", appearance: "black hair, brown eyes", attire: "hanbok", priority: 1, updated_at: 10, id: "filled", scope: "live" },
  ]);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].id, "filled");
  assert.equal(winners[0].appearance, "black hair, brown eyes");
});

test("mergeSessionAndGlobalRoster lets a later filled session row replace an earlier empty one", () => {
  const session = [
    { name: "민희", appearance: "", attire: "", id: "empty", scope: "other" },
    { name: "민희", appearance: "black hair", attire: "hanbok", id: "filled", scope: "live" },
  ];
  const merged = mergeSessionAndGlobalRoster(session, [], helpers());
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "filled");
  assert.equal(merged[0].appearance, "black hair");
});

test("matchCharactersInText returns roster rows whose aliases appear in the message", () => {
  const roster = [
    { id: "a", name: "유나", aliases: ["유나", "Yuna"] },
    { id: "b", name: "하루", aliases: ["하루"] },
    { id: "c", name: "민희", aliases: ["민희"] },
  ];
  const hits = matchCharactersInText("카페에서 유나가 하루를 불렀다", roster);
  assert.deepEqual(hits.map((c) => c.name), ["유나", "하루"]);
});

test("tagger trigger list is one merged roster match, not separate global+session lists", () => {
  const session = [{ id: "yuna-chat", name: "유나", aliases: ["유나"], appearance: "1girl, black hair" }];
  const global = [{ id: "yuna-g", name: "유나", aliases: ["유나"], appearance: "1girl, blonde hair" }];
  const roster = mergeSessionAndGlobalRoster(session, global, {
    hasAppearance: (c) => !!String(c?.appearance || "").trim(),
    resolve: (name, list) => list.find((c) => c.name === name) || null,
    aliasKeys: (c) => new Set((c.aliases || [c.name]).map((a) => String(a).toLowerCase())),
    normalizeName: (n) => String(n || "").trim().toLowerCase(),
    clean: (v) => String(v || "").trim(),
  });
  const hits = matchCharactersInText("오늘 유나가 카페에 왔다", roster);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, roster[0].id);
});

test("linked-chat merge scan follows unified_chat_priority, not just source ids", () => {
  const linked = ["sess_here", "sess_other"];
  assert.equal(scanLinkedChatsForRosterMerge(false, linked), false);
  assert.equal(scanLinkedChatsForRosterMerge(true, linked), true);
  assert.equal(scanLinkedChatsForRosterMerge(true, []), false);
  assert.equal(scanLinkedChatsForRosterMerge(true, ["", "  "]), false);
});

