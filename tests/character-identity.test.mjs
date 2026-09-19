import test from "node:test";
import assert from "node:assert/strict";

import {
  migrateCharacter,
  resolveCharacterIdentity,
  mergeCharacterView,
  sameFullNameIdentity,
  characterMatchesIdentity,
  latinNameTokens,
  latinGivenTokenOverlap,
  absorbAliasesFromDonor,
  ASSET_LOOKS_PRIORITY,
} from "../.test-build/character-identity.mjs";

test("shared surname never merges different full names", () => {
  const jinwoo = migrateCharacter({ id: "jinwoo", name: "HAN JINWOO", aliases: ["HAN", "JINWOO"] });
  const mina = migrateCharacter({ id: "mina", name: "HAN MINA", aliases: ["HAN", "MINA"] });

  assert.equal(resolveCharacterIdentity("HAN JINWOO", [jinwoo, mina])?.id, "jinwoo");
  assert.equal(resolveCharacterIdentity("HAN MINA", [jinwoo, mina])?.id, "mina");
  assert.equal(resolveCharacterIdentity("HAN", [jinwoo, mina]), null);
  assert.equal(sameFullNameIdentity(jinwoo, mina), false);
});

test("explicit full-name variants resolve while surname variants remain ambiguous", () => {
  const chars = [
    migrateCharacter({
      id: "a",
      name: "한진우",
      surname: "한",
      given_name: "진우",
      surname_variants: ["HAN"],
      given_name_variants: ["JINWOO"],
      aliases: ["HAN JINWOO"],
    }),
    migrateCharacter({
      id: "b",
      name: "한미나",
      surname: "한",
      given_name: "미나",
      surname_variants: ["HAN"],
      given_name_variants: ["MINA"],
      aliases: ["HAN MINA"],
    }),
  ];

  assert.equal(resolveCharacterIdentity("HAN JINWOO", chars)?.id, "a");
  assert.equal(resolveCharacterIdentity("HAN MINA", chars)?.id, "b");
  assert.equal(resolveCharacterIdentity("HAN", chars), null);
});

test("merge only when surname AND given overlap across KR/EN variants", () => {
  const kr = migrateCharacter({
    id: "kr",
    name: "한진우",
    surname: "한",
    given_name: "진우",
    surname_variants: ["HAN"],
    given_name_variants: ["JINWOO"],
    aliases: ["한진우"],
    appearance: "boy, black hair",
    created_at: 1,
  });
  const en = migrateCharacter({
    id: "en",
    name: "HAN JINWOO",
    surname: "HAN",
    given_name: "JINWOO",
    surname_variants: ["한"],
    given_name_variants: ["진우"],
    aliases: ["HAN JINWOO", "진우"],
    appearance: "boy, black hair, short hair, blue eyes",
    priority: 5,
    created_at: 2,
  });
  const other = migrateCharacter({
    id: "other",
    name: "Alice",
    aliases: ["ALICE LIDDELL"],
    created_at: 3,
  });

  assert.equal(sameFullNameIdentity(kr, en), true);
  assert.equal(sameFullNameIdentity(kr, other), false);

  const view = mergeCharacterView([kr, en, other]);
  assert.equal(view.records.length, 3);
  assert.equal(view.active.length, 2);
  assert.equal(view.active.find((entry) => entry.id === "en" || entry.name.includes("JINWOO") || entry.name.includes("진우"))?.id, "en");
  assert.ok(view.active.some((entry) => entry.id === "other"));
  // Fold keeps sibling aliases; does not drop source records.
  const folded = view.active.find((entry) => entry.id === "en");
  assert.ok(folded.aliases.some((alias) => /진우|JINWOO|한진우/i.test(alias)));
  assert.ok(String(folded.appearance || "").includes("blue eyes"));
});

test("alias-only overlap does not merge without surname+given match", () => {
  const source = [
    migrateCharacter({ id: "older", name: "Alice", aliases: ["ALICE LIDDELL"], created_at: 1 }),
    migrateCharacter({ id: "manual", name: "Alice Liddell", aliases: ["ALICE LIDDELL"], priority: 10, created_at: 2 }),
  ];
  const view = mergeCharacterView(source);
  assert.equal(view.records.length, 2);
  assert.equal(view.active.length, 2);
});

test("migration is idempotent and preserves legacy aliases", () => {
  const legacy = { id: "x", name: "HAN JINWOO", aliases: ["HAN", "JINWOO", "HAN JINWOO"] };
  const once = migrateCharacter(legacy);
  const twice = migrateCharacter(once);

  assert.deepEqual(twice, once);
  assert.deepEqual(once.aliases, legacy.aliases);
  assert.equal(once.schema_version, 2);
});

test("unambiguous single-token nicknames resolve but surname-only aliases do not", () => {
  const taeyang = migrateCharacter({ id: "sun", name: "태양", aliases: ["Taeyang"] });
  const jinwoo = migrateCharacter({ id: "han", name: "HAN JINWOO", aliases: ["HAN", "JINWOO"] });

  assert.equal(resolveCharacterIdentity("Taeyang", [taeyang, jinwoo])?.id, "sun");
  assert.equal(resolveCharacterIdentity("HAN", [taeyang, jinwoo]), null);
});

test("mixed-case Western names are not guessed as surname-first", () => {
  const alice = migrateCharacter({ id: "alice", name: "Alice Liddell" });
  assert.equal(alice.surname, "");
  assert.equal(alice.given_name, "");
});

test("characterMatchesIdentity links unified row to per-chat row by alias/name", () => {
  const unified = migrateCharacter({
    id: "u1",
    name: "Yoon Ji-soo",
    aliases: ["윤지수", "Yoon Ji-soo"],
    surname: "Yoon",
    given_name: "Ji-soo",
  });
  const chatRow = migrateCharacter({
    id: "c9",
    name: "윤지수",
    aliases: ["Yoon Ji-soo"],
  });
  const other = migrateCharacter({ id: "c2", name: "Park Tae-geon", aliases: ["박태건"] });
  assert.equal(characterMatchesIdentity(unified, chatRow), true);
  assert.equal(characterMatchesIdentity(unified, other), false);
  assert.equal(characterMatchesIdentity({ id: "x" }, { id: "x", name: "A" }), true);
});

test("latin given tokens match asset mononym to fuller Graymour row", () => {
  const asset = migrateCharacter({
    id: "asset-hanna",
    name: "hanna",
    given_name: "hanna",
    given_name_variants: ["hanna"],
    aliases: ["hanna"],
    appearance: "1girl, brown hair",
    priority: ASSET_LOOKS_PRIORITY,
  });
  const fuller = migrateCharacter({
    id: "graymour",
    name: "한나 그레이무어",
    surname: "그레이무어",
    given_name: "한나",
    surname_variants: ["graymour", "greymoor"],
    given_name_variants: ["hanna", "hannah"],
    aliases: ["한나 그레이무어", "Hanna Graymour", "Hannah GreyMoor"],
  });
  assert.ok(latinNameTokens(asset).has("hanna"));
  assert.ok(latinGivenTokenOverlap(asset, fuller));
  assert.equal(sameFullNameIdentity(asset, fuller), false);
  const absorbed = absorbAliasesFromDonor(asset, fuller);
  assert.ok(absorbed.some((a) => /Graymour/i.test(a) || /그레이무어/.test(a)));
  assert.ok(absorbed.some((a) => /hanna/i.test(a)));
});

test("latin overlap requires shared ASCII given token", () => {
  const a = migrateCharacter({ name: "hanna", given_name: "hanna" });
  const b = migrateCharacter({ name: "mina", given_name: "mina", given_name_variants: ["MINA"] });
  assert.equal(latinGivenTokenOverlap(a, b), false);
});
