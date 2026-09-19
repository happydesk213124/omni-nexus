import test from "node:test";
import assert from "node:assert/strict";

import {
  isCharacterImageExtraLore,
  parseCharacterImageTagLore,
  trimCharacterImageTagLore,
  matchCharacterImageSectionTitles,
} from "../src/lore-extra.js";

const SAMPLE = `## Character Image Tags
These are the original tags used for character images.

### Yoon Ji-soo
1girl, mature woman, dark brown eyes

### Park Tae-geon
1man, solo, sharp face

## Yoo Tae-sung
1man, average looking
`;

test("isCharacterImageExtraLore matches comment/name", () => {
  assert.equal(isCharacterImageExtraLore({ comment: "lb-xnai.lb.extra" }), true);
  assert.equal(isCharacterImageExtraLore({ name: "LB-XNAI.LB.EXTRA" }), true);
  assert.equal(isCharacterImageExtraLore({ comment: "other lore" }), false);
});

test("parseCharacterImageTagLore splits header and ##/### character sections", () => {
  const parsed = parseCharacterImageTagLore(SAMPLE);
  assert.match(parsed.header, /Character Image Tags/);
  assert.match(parsed.header, /original tags used for character images/);
  assert.equal(parsed.sections.length, 3);
  assert.equal(parsed.sections[0].title, "Yoon Ji-soo");
  assert.equal(parsed.sections[0].hashes, "###");
  assert.match(parsed.sections[0].body, /1girl, mature woman/);
  assert.equal(parsed.sections[1].title, "Park Tae-geon");
  assert.equal(parsed.sections[2].title, "Yoo Tae-sung");
  assert.equal(parsed.sections[2].hashes, "##");
});

test("matchCharacterImageSectionTitles returns only names present in message", () => {
  const hits = matchCharacterImageSectionTitles(
    SAMPLE,
    "유리문이 열리며 Yoon Ji-soo가 들어온다. Park는 아직 없다.",
  );
  assert.deepEqual(hits, ["Yoon Ji-soo"]);
});

test("matchCharacterImageSectionTitles opens section via other lore trigger aliases", () => {
  // Message only has Korean; character lore keys include English section title.
  const hits = matchCharacterImageSectionTitles(
    SAMPLE,
    "윤지수가 문을 열었다",
    ["윤지수", "Yoon Ji-soo", "윤 지수"],
  );
  assert.deepEqual(hits, ["Yoon Ji-soo"]);
});

test("trimCharacterImageTagLore keeps only trigger-matched sections", () => {
  const out = trimCharacterImageTagLore(SAMPLE, [], ["Yoon Ji-soo"]);
  assert.match(out, /Character Image Tags/);
  assert.match(out, /Yoon Ji-soo/);
  assert.match(out, /1girl, mature woman/);
  assert.doesNotMatch(out, /Park Tae-geon/);
  assert.doesNotMatch(out, /Yoo Tae-sung/);
});

test("trimCharacterImageTagLore omits entry when no trigger names", () => {
  assert.equal(trimCharacterImageTagLore(SAMPLE, [], []), "");
  assert.equal(trimCharacterImageTagLore(SAMPLE, ["Yoon Ji-soo"]), "");
});

test("trimCharacterImageTagLore drops filled even if trigger matched", () => {
  const out = trimCharacterImageTagLore(
    SAMPLE,
    ["Yoon Ji-soo"],
    ["Yoon Ji-soo", "Park Tae-geon"],
  );
  assert.doesNotMatch(out, /Yoon Ji-soo/);
  assert.match(out, /Park Tae-geon/);
  assert.doesNotMatch(out, /Yoo Tae-sung/);
});

test("trimCharacterImageTagLore drops filled when alias matches section title", () => {
  // Roster display name is Korean; English section title lives only in aliases/triggers.
  const out = trimCharacterImageTagLore(
    SAMPLE,
    ["윤지수", "Yoon Ji-soo"],
    ["Yoon Ji-soo", "Park Tae-geon"],
  );
  assert.doesNotMatch(out, /Yoon Ji-soo/);
  assert.match(out, /Park Tae-geon/);
});

test("trimCharacterImageTagLore name match ignores punctuation/case", () => {
  const out = trimCharacterImageTagLore(SAMPLE, [], ["yoon ji-soo", "PARK TAE GEON"]);
  assert.match(out, /Yoon Ji-soo/);
  assert.match(out, /Park Tae-geon/);
  assert.doesNotMatch(out, /Yoo Tae-sung/);
});

test("주미래 / Joo Mi-rae keys do not unlock unrelated Character Image Tag sections", () => {
  const keep = matchCharacterImageSectionTitles(
    SAMPLE,
    "주미래가 책상으로 걸어갔다",
    ["주미래", "Joo Mi-rae", "Mi-rae"],
  );
  assert.deepEqual(keep, []);
  assert.equal(trimCharacterImageTagLore(SAMPLE, [], keep), "");
});

test("only unlocked section is kept — never the whole Character Image Tags file", () => {
  const keep = matchCharacterImageSectionTitles(
    SAMPLE,
    "윤지수가 문을 열었다",
    ["윤지수", "Yoon Ji-soo"],
  );
  assert.deepEqual(keep, ["Yoon Ji-soo"]);
  const out = trimCharacterImageTagLore(SAMPLE, [], keep);
  assert.match(out, /### Yoon Ji-soo/);
  assert.doesNotMatch(out, /Park Tae-geon/);
  assert.doesNotMatch(out, /Yoo Tae-sung/);
  assert.doesNotMatch(out, /Han Yeon-hee/);
});
