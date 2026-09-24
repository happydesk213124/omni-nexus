import test from "node:test";
import assert from "node:assert/strict";

import {
  applyComicKindGuard,
  clampComicByRatio,
  clampComicPages,
  comicCapFromRatio,
  comicLineRange,
  comicGenOn,
  normalizeShotKind,
} from "../.test-build/comic-kind.mjs";
import { pickNextReadyShot } from "../.test-build/comic-schedule.mjs";
import { comicPairsUsable, resolveComicUseCoords } from "../.test-build/comic-coords.mjs";
import { formatComicNowWearingBlock, resolveComicSlotCostume } from "../.test-build/comic-costume.mjs";
import { assignComicPagesToShots, attachInlineComicPages, comicCutHidesLooks, comicSlotLimit, normalizeComicCutKind, parseComicPages, shotKeepsComicSlots, takeComicGenerationSlots } from "../.test-build/comic-page.mjs";
import { stripComicKomaFromUc, stripComicPageStyleTags, stripComicStyleWords } from "../.test-build/comic-tags.mjs";
import { comicSpeechCaption, composeComicSlotCaption } from "../.test-build/comic-caption.mjs";
import { comicLlmWithMain, normalizeComicLlmBatch, resolveComicNaiParams } from "../.test-build/comic-params.mjs";
import { COMIC_FULL_MESSAGE_REF, comicProseBlockForLlm } from "../.test-build/comic-llm-prose.mjs";
import { applyComicAspect, normalizeComicAspect } from "../.test-build/comic-aspect.mjs";
import { appendNoHumansWhenNoCast } from "../.test-build/character-tags.mjs";

test("normalizeShotKind maps comic aliases", () => {
  assert.equal(normalizeShotKind("comic"), "comic");
  assert.equal(normalizeShotKind("illustration"), "illustration");
  assert.equal(normalizeShotKind(""), "illustration");
});

test("comicGenOn is off unless on", () => {
  assert.equal(comicGenOn({}), false);
  assert.equal(comicGenOn({ comic_gen: "off" }), false);
  assert.equal(comicGenOn({ comic_gen: "on" }), true);
});

test("comic LLM prose is the page range plus a compressed full-message reference", () => {
  const css = ".chattext .x-risu-ngs-card{position:relative;display:flex;padding:8px}";
  const msg = ["one", "two", "three", css, "five"].join("\n");
  const block = comicProseBlockForLlm(msg, 3, 5);
  assert.match(block, /^L3\|three\nL4\|maybeCSSCode<< /);
  assert.match(block, /\nL5\|five\n\n/);
  assert.ok(block.includes(COMIC_FULL_MESSAGE_REF));
  assert.match(block, /L1\|one/);
  assert.match(block, /L4\|maybeCSSCode<< /);
  assert.ok(!block.includes("padding:8px}"));
});

test("comic LLM prose skips a duplicate full copy when the range is the whole message", () => {
  const block = comicProseBlockForLlm("a\nb\nc", 1, 3);
  assert.equal(block, "L1|a\nL2|b\nL3|c");
  assert.ok(!block.includes(COMIC_FULL_MESSAGE_REF));
});

test("comicLineRange clamps and never uses a neighbor", () => {
  assert.deepEqual(comicLineRange(7, 12, 20), [7, 12]);
  assert.deepEqual(comicLineRange(12, 7, 20), [12, 12]);
  assert.deepEqual(comicLineRange(1, 99, 10), [1, 10]);
  assert.deepEqual(comicLineRange(null, null, 8), [1, 1]);
});

test("clampComicPages keeps first N comics and turns extras into illustration", () => {
  const shots = [
    { kind: "illustration" },
    { kind: "comic" },
    { kind: "comic" },
    { kind: "illustration" },
    { kind: "comic", comic_line_end: 9 },
  ];
  const out = clampComicPages(shots, 2);
  assert.equal(out.filter((s) => s.kind === "comic").length, 2);
  assert.equal(out.length, 5);
  assert.equal(out[out.length - 1].kind, "illustration");
  assert.equal(out[out.length - 1].comic_line_end, undefined);
});

test("clampComicByRatio uses percent of the shot list", () => {
  assert.equal(comicCapFromRatio(4, 50), 2);
  assert.equal(comicCapFromRatio(1, 0), 0);
  const shots = [
    { kind: "comic" },
    { kind: "comic" },
    { kind: "comic" },
    { kind: "illustration" },
  ];
  const out = clampComicByRatio(shots, 50);
  assert.equal(out.filter((s) => s.kind === "comic").length, 2);
  assert.equal(out.length, 4);
});

test("applyComicKindGuard drops kind when tab is off", () => {
  const shots = [{ kind: "comic", comic_line_end: 9, line: 3 }];
  applyComicKindGuard(shots, false);
  assert.equal(shots[0].kind, undefined);
  assert.equal(shots[0].comic_line_end, undefined);
});

test("pickNextReadyShot takes the smallest ready index", () => {
  const order = [0, 1, 2, 3, 4, 5, 6];
  const done = new Set();
  const inflight = new Set();
  const ready = new Set([0, 1, 3, 4, 6]);
  assert.equal(pickNextReadyShot({ order, done, inflight, ready }), 0);
  done.add(0);
  done.add(1);
  inflight.add(3);
  assert.equal(pickNextReadyShot({ order, done, inflight, ready }), 4);
  done.add(4);
  ready.add(2);
  ready.add(5);
  inflight.delete(3);
  assert.equal(pickNextReadyShot({ order, done, inflight, ready }), 2);
});

test("resolveComicUseCoords falls back when a pair is missing", () => {
  const ok = [{ x: 0.3, y: 0.2 }, { x: 0.7, y: 0.2 }];
  assert.equal(resolveComicUseCoords("position", "", ok), true);
  assert.equal(resolveComicUseCoords("position", "", [ok[0], null]), false);
  assert.equal(resolveComicUseCoords("ai_choice", "position", ok), false);
  assert.equal(resolveComicUseCoords("llm", "ai_choice", ok), false);
  assert.equal(resolveComicUseCoords("llm", "position", ok), true);
  assert.equal(resolveComicUseCoords("llm", "", ok), false);
  assert.equal(resolveComicUseCoords("position", "", [{ x: 0.5, y: 0.5 }]), true);
  assert.equal(comicPairsUsable([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }]), false);
});

test("resolveComicSlotCostume expands a name and keeps raw tags", () => {
  const stored = {
    costumes: [
      { name: "default", attire: "shirt", accessories: "" },
      { name: "maid", attire: "navy dress, white apron", accessories: "hair ribbon" },
    ],
    active_costume: 0,
  };
  const named = resolveComicSlotCostume(stored, "maid");
  assert.equal(named.mode, "named");
  assert.match(named.attire, /navy dress/);
  const raw = resolveComicSlotCostume(stored, "wet shirt, torn skirt");
  assert.equal(raw.mode, "raw");
  assert.equal(raw.attire, "wet shirt, torn skirt");
  const empty = resolveComicSlotCostume(stored, "");
  assert.equal(empty.mode, "fallback");
  assert.equal(empty.attire, "shirt");
});

test("formatComicNowWearingBlock tells the LLM the live costume and accessory on/off", () => {
  const on = formatComicNowWearingBlock({
    costumeName: "maid",
    wearState: "clothed",
    accessories: "hair ribbon, holster",
  });
  assert.match(on, /now_wearing: maid/);
  assert.match(on, /wear_state: clothed/);
  assert.match(on, /accessories: on \(hair ribbon, holster\)/);
  const off = formatComicNowWearingBlock({ wearState: "nude" });
  assert.match(off, /now_wearing: default/);
  assert.match(off, /wear_state: nude/);
  assert.match(off, /accessories: off/);
});

test("normalizeComicLlmBatch accepts with_main", () => {
  assert.equal(normalizeComicLlmBatch("once"), "once");
  assert.equal(normalizeComicLlmBatch("per_shot"), "per_shot");
  assert.equal(normalizeComicLlmBatch("with_main"), "with_main");
  assert.equal(normalizeComicLlmBatch("with-main"), "with_main");
  assert.equal(comicLlmWithMain("with_main"), true);
  assert.equal(comicLlmWithMain("once"), false);
});

test("normalizeComicCutKind maps aliases and falls back to normal", () => {
  assert.equal(normalizeComicCutKind("normal"), "normal");
  assert.equal(normalizeComicCutKind("background"), "background");
  assert.equal(normalizeComicCutKind("closeup"), "closeup");
  assert.equal(normalizeComicCutKind("close-up"), "closeup");
  assert.equal(normalizeComicCutKind("cross_section"), "cross_section");
  assert.equal(normalizeComicCutKind("cross-section"), "cross_section");
  assert.equal(normalizeComicCutKind("upperbody"), "upperbody");
  assert.equal(normalizeComicCutKind("whatever"), "normal");
  assert.equal(normalizeComicCutKind(undefined), "normal");
  assert.equal(comicCutHidesLooks("closeup"), true);
  assert.equal(comicCutHidesLooks("cross_section"), true);
  assert.equal(comicCutHidesLooks("normal"), false);
  assert.equal(comicCutHidesLooks("upperbody"), false);
  assert.equal(comicCutHidesLooks("background"), false);
});

const CUT_PAGE = {
  koma: 99,
  location: "tatami, paper lantern, indoor",
  aspect: "portrait",
  coords: "position",
  cuts: [
    {
      cut_kind: "normal",
      base: "wooden hallway, afternoon light, cowboy shot",
      characters: [
        { name: "테아", action: "grabbing arm, blush", source: "grab", costume: "coat", text: "", center_x: 0.35, center_y: 0.4 },
        { name: "카엘", action: "surprised, stepping back", target: "grab", costume: "shirt", text: "놔!", center_x: 0.65, center_y: 0.4 },
      ],
    },
    {
      cut_kind: "close-up",
      base: "2::close-up::, woman, eyes, teary",
      characters: [
        { name: "테아", action: "2::close-up::, teary eyes", bubble: "thought", text: "…" },
      ],
    },
    {
      cut_kind: "background",
      base: "2::no humans::, empty hallway, dusk",
      characters: [{ name: "테아", action: "should be dropped", costume: "coat" }],
    },
  ],
};

test("parseComicPages reads cuts: koma=cuts.length, aliases, background strays dropped", () => {
  const pages = parseComicPages({ pages: [CUT_PAGE] });
  assert.equal(pages.length, 1);
  // LLM-sent koma:99 is ignored — cuts.length is the source of truth.
  assert.equal(pages[0].koma, 3);
  assert.deepEqual(pages[0].cuts.map((c) => c.cut_kind), ["normal", "closeup", "background"]);
  assert.equal(pages[0].cuts[2].characters.length, 0);
  // Flattened slots carry their cut kind in cut order (max 6).
  assert.equal(pages[0].slots.length, 3);
  assert.deepEqual(pages[0].slots.map((s) => s.cut_kind), ["normal", "normal", "closeup"]);
  // Interaction keys survive the parse.
  assert.equal(pages[0].slots[0].source, "grab");
  assert.equal(pages[0].slots[1].target, "grab");
  // Weighted kind tag in a character entry is unwrapped to the bare form.
  assert.equal(pages[0].slots[2].action, "close-up, teary eyes");
  assert.ok(!pages[0].slots[2].action.includes("2::"));
});

test("parseComicPages synthesises layout from cut bases", () => {
  const pages = parseComicPages({ pages: [CUT_PAGE] });
  assert.match(pages[0].layout, /cut 1 is scene\. wooden hallway/);
  assert.match(pages[0].layout, /cut 2 is close-up scene\. 2::close-up::, woman, eyes, teary/);
  assert.match(pages[0].layout, /cut 3 is scenery\. 2::no humans::, empty hallway, dusk/);
});

test("parseComicPages caps cuts at 6 and slots at 6", () => {
  const cuts = Array.from({ length: 8 }, (_, i) => ({
    cut_kind: "normal",
    base: `place ${i}`,
    characters: [{ name: `p${i}`, action: "stand", costume: "coat" }],
  }));
  const pages = parseComicPages({ pages: [{ cuts }] });
  assert.equal(pages[0].cuts.length, 6);
  assert.equal(pages[0].koma, 6);
  assert.equal(pages[0].slots.length, 6);
});

test("parseComicPages keeps a background-only page with zero slots", () => {
  const pages = parseComicPages({
    pages: [{ cuts: [{ cut_kind: "background", base: "2::no humans::, empty street, night", characters: [] }] }],
  });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].koma, 1);
  assert.equal(pages[0].slots.length, 0);
});

test("parseComicPages rejects the retired slots shape", () => {
  const pages = parseComicPages({
    pages: [{
      koma: 2,
      layout: "1::old shape.::",
      slots: [{ name: "테아", action: "stand", costume: "coat" }],
    }],
  });
  assert.equal(pages.length, 0);
});

test("parseComicPages reads cut character wear_state", () => {
  const pages = parseComicPages({
    pages: [{ cuts: [{ cut_kind: "normal", base: "room", characters: [{ name: "테아", action: "stand", costume: "coat", wear_state: "bottomless" }] }] }],
  });
  assert.equal(pages[0].slots[0].wear_state, "bottomless");
});

test("attachInlineComicPages flattens cuts and passes cut_kind to characters", () => {
  const shots = [{
    kind: "comic",
    aspect: "portrait",
    characters: [{ name: "테아" }, { name: "카엘" }],
    comic_page: CUT_PAGE,
  }];
  const assigned = attachInlineComicPages(shots);
  assert.deepEqual([...assigned], [0]);
  assert.equal(shots[0].characters.length, 3);
  assert.equal(shots[0].characters[2].cut_kind, "closeup");
  assert.equal(shots[0].characters[0].source, "grab");
  assert.equal(shots[0].characters[1].target, "grab");
  assert.equal(shots[0].comic_page.koma, 3);
  assert.equal(shotKeepsComicSlots(shots[0]), true);
  assert.equal(shotKeepsComicSlots({ kind: "comic", characters: [{ name: "테아" }] }), false);
});

test("attachInlineComicPages ignores shot-root layout so characters stay the cast", () => {
  const shots = [{
    kind: "comic",
    layout: "1::do not use.::",
    koma: 3,
    characters: [{ name: "테아", action: "cast only" }],
  }];
  const assigned = attachInlineComicPages(shots);
  assert.equal(assigned.size, 0);
  assert.equal(shots[0].characters.length, 1);
  assert.equal(shots[0].characters[0].action, "cast only");
});

test("comic generation slots ignore card character_max and stop at 6", () => {
  assert.equal(comicSlotLimit(), 6);
  const seven = Array.from({ length: 7 }, (_, i) => ({ name: `p${i}` }));
  assert.equal(takeComicGenerationSlots(seven).length, 6);
  assert.equal(takeComicGenerationSlots(seven.slice(0, 5)).length, 5);
  const pages = parseComicPages({
    pages: [{
      cuts: [{
        cut_kind: "normal",
        base: "hall",
        characters: seven.map((row) => ({ name: row.name, action: "stand", costume: "coat" })),
      }],
    }],
  });
  assert.equal(pages[0].slots.length, 6);
});

test("parseComicPages + assign fills unmatched comics in order", () => {
  const pages = parseComicPages({
    pages: [
      {
        aspect: "portrait",
        coords: "position",
        location: "hallway, indoor",
        cuts: [
          {
            cut_kind: "normal",
            base: "hallway, cowboy shot",
            characters: [{ name: "테아", action: "blush", costume: "maid", text: "안녕", center_x: 0.5, center_y: 0.2 }],
          },
        ],
      },
    ],
  });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].koma, 1);
  const shots = [
    { kind: "illustration", characters: [] },
    { kind: "comic", characters: [{ name: "x" }] },
  ];
  const assigned = assignComicPagesToShots(shots, pages);
  assert.ok(assigned.has(1));
  assert.equal(shots[1].characters[0].name, "테아");
  assert.equal(shots[1].comic_page.koma, 1);
});

test("assignComicPagesToShots keeps the first tagger aspect over the comic page", () => {
  const pages = parseComicPages({
    pages: [{
      aspect: "landscape",
      cuts: [{ cut_kind: "normal", base: "wide hall", characters: [{ name: "테아", action: "stand", costume: "maid" }] }],
    }],
  });
  const shots = [
    { kind: "comic", aspect: "portrait", characters: [] },
  ];
  assignComicPagesToShots(shots, pages);
  assert.equal(shots[0].aspect, "portrait");
  assert.equal(shots[0].comic_page.aspect, "portrait");
});

test("assignComicPagesToShots fills a missing first-tagger aspect as portrait", () => {
  const pages = parseComicPages({
    pages: [{
      aspect: "landscape",
      cuts: [{ cut_kind: "normal", base: "wide hall", characters: [{ name: "테아", action: "stand", costume: "maid" }] }],
    }],
  });
  const shots = [{ kind: "comic", characters: [] }];
  assignComicPagesToShots(shots, pages);
  assert.equal(shots[0].aspect, "portrait");
});

test("strip comic/manga from positive and 4koma from UC", () => {
  assert.equal(stripComicPageStyleTags("comic, manga, 3::5koma::, best quality"), "3::5koma::, best quality");
  assert.equal(stripComicKomaFromUc("lowres, 4koma, 2koma, blurry"), "lowres, blurry");
  assert.equal(stripComicStyleWords("comic hallway, manga tone hatching"), "hallway, tone");
});

test("comicSpeechCaption builds a bubble tag", () => {
  assert.equal(
    comicSpeechCaption("speech", "하아..."),
    "speechbubble, korean text:하아...",
  );
  assert.equal(
    comicSpeechCaption("thought", "안돼, 가지마"),
    "thought bubble, korean text:안돼, 가지마",
  );
});

test("attachInlineComicPages inherits cast wear_state onto omitted slots", () => {
  const shots = [{
    kind: "comic",
    characters: [{ name: "테아", wear_state: "nude" }],
    comic_page: {
      cuts: [
        { cut_kind: "normal", base: "room", characters: [{ name: "테아", action: "C1", costume: "coat" }] },
        { cut_kind: "normal", base: "room", characters: [{ name: "테아", action: "C2", costume: "coat", wear_state: "bottomless" }] },
      ],
    },
  }];
  attachInlineComicPages(shots);
  assert.equal(shots[0].characters[0].wear_state, "nude");
  assert.equal(shots[0].characters[1].wear_state, "bottomless");
});

test("composeComicSlotCaption keeps looks, costume, action, and korean text", () => {
  const caption = composeComicSlotCaption(
    {
      name: "히나",
      appearance: "blonde hair, blue eyes",
      costumes: [{ name: "maid", attire: "navy dress, white apron", accessories: "hair ribbon" }],
      active_costume: 0,
    },
    {
      name: "히나",
      action: "walking, blush",
      costume: "maid",
      bubble: "speech",
      speech: "아.... 힘들다...",
      cut_kind: "normal",
    },
  );
  assert.match(caption, /blonde hair/);
  assert.match(caption, /navy dress/);
  assert.match(caption, /walking/);
  assert.match(caption, /speechbubble, korean text:아\.\.\.\. 힘들다\.\.\./);
});

test("composeComicSlotCaption forwards source/target/mutual as #-tags", () => {
  const caption = composeComicSlotCaption(
    {
      name: "히나",
      appearance: "blonde hair",
      costumes: [{ name: "maid", attire: "navy dress", accessories: "" }],
      active_costume: 0,
    },
    {
      name: "히나",
      action: "grabbing arm",
      source: "grab",
      mutual: "embrace",
      costume: "maid",
      cut_kind: "normal",
    },
  );
  assert.match(caption, /navy dress/);
  assert.match(caption, /source#grab/);
  assert.match(caption, /mutual#embrace/);
  const receiver = composeComicSlotCaption(
    {
      name: "카엘",
      appearance: "black hair",
      costumes: [{ name: "shirt", attire: "white shirt", accessories: "" }],
      active_costume: 0,
    },
    { name: "카엘", action: "stepping back", target: "grab", mutual: "embrace", costume: "shirt", cut_kind: "normal" },
  );
  assert.match(receiver, /target#grab/);
  assert.match(receiver, /mutual#embrace/);
});

test("composeComicSlotCaption hides roster looks on closeup cuts but keeps action and speech", () => {
  const caption = composeComicSlotCaption(
    {
      name: "히나",
      appearance: "blonde hair, blue eyes",
      costumes: [{ name: "maid", attire: "navy dress, white apron", accessories: "hair ribbon" }],
      active_costume: 0,
    },
    {
      name: "히나",
      action: "close-up, teary eyes",
      source: "grab",
      costume: "maid",
      bubble: "thought",
      speech: "미안해",
      cut_kind: "closeup",
    },
  );
  // This is the guard that proves looks-OFF: break it (apply roster looks
  // here) and navy dress / blonde hair leak back into the caption.
  assert.ok(!caption.includes("navy dress"), `looks leaked: ${caption}`);
  assert.ok(!caption.includes("blonde hair"), `looks leaked: ${caption}`);
  assert.ok(!caption.includes("hair ribbon"), `looks leaked: ${caption}`);
  assert.match(caption, /teary eyes/);
  assert.match(caption, /source#grab/);
  assert.match(caption, /thought bubble, korean text:미안해/);
});

test("composeComicSlotCaption hides roster looks on cross_section cuts", () => {
  const caption = composeComicSlotCaption(
    {
      name: "히나",
      appearance: "blonde hair",
      costumes: [{ name: "dress", attire: "red dress", accessories: "" }],
      active_costume: 0,
    },
    { name: "히나", action: "cross-section, fetus", cut_kind: "cross_section" },
  );
  assert.ok(!caption.includes("red dress"), `looks leaked: ${caption}`);
  assert.ok(!caption.includes("blonde hair"), `looks leaked: ${caption}`);
  assert.match(caption, /cross-section/);
});

test("composeComicSlotCaption applies wear_state like illustration", () => {
  const caption = composeComicSlotCaption(
    {
      name: "히나",
      appearance: "blonde hair",
      gender: "girl",
      costumes: [{ name: "maid", attire: "navy dress", accessories: "" }],
      active_costume: 0,
      wear_state: "clothed",
    },
    {
      name: "히나",
      action: "standing",
      costume: "maid",
      wear_state: "bottomless",
      cut_kind: "normal",
    },
  );
  assert.match(caption, /navy dress/);
  assert.equal(caption.includes("0.6::"), false);
  assert.match(caption, /2::bottomless::/);
  assert.match(caption, /pussy/);
});

test("appendNoHumansWhenNoCast skips when a weighted no-humans group is present", () => {
  assert.equal(
    appendNoHumansWhenNoCast("2::no humans::, empty street, night", 0, true),
    "2::no humans::, empty street, night",
  );
  assert.equal(appendNoHumansWhenNoCast("forest, night", 0, true), "forest, night, no humans");
});

test("normalizeComicAspect defaults to llm", () => {
  assert.equal(normalizeComicAspect(undefined), "llm");
  assert.equal(normalizeComicAspect("landscape"), "landscape");
  assert.equal(normalizeComicAspect("가로"), "landscape");
  assert.equal(normalizeComicAspect("square"), "square");
  assert.equal(normalizeComicAspect("1:1"), "square");
  assert.equal(normalizeComicAspect("portrait"), "portrait");
});

test("applyComicAspect only rewrites comic shots", () => {
  const shots = [
    { kind: "illustration", aspect: "landscape" },
    { kind: "comic", aspect: "portrait" },
  ];
  const out = applyComicAspect(shots, "square");
  assert.equal(out[0].aspect, "landscape");
  assert.equal(out[1].aspect, "square");
});

test("applyComicAspect llm keeps tagger comic aspect", () => {
  const shots = [{ kind: "comic", aspect: "landscape" }];
  const out = applyComicAspect(shots, "llm");
  assert.equal(out[0].aspect, "landscape");
});

test("resolveComicNaiParams uses empty overrides as existing V5 values", () => {
  const nai = { steps_v5: 28, sampler_v5: "k_euler_ancestral", cfg_scale: 5, cfg_rescale: 0 };
  const empty = resolveComicNaiParams({ comic_steps: "", comic_sampler: "", comic_cfg_scale: "", comic_cfg_rescale: "" }, nai, null);
  assert.equal(empty.steps, 28);
  assert.equal(empty.sampler, "k_euler_ancestral");
  assert.equal(empty.cfg_scale, 5);
  const over = resolveComicNaiParams({ comic_steps: 40, comic_sampler: "k_euler", comic_cfg_scale: 6.5, comic_cfg_rescale: 0.2 }, nai, null);
  assert.equal(over.steps, 40);
  assert.equal(over.sampler, "k_euler");
  assert.equal(over.cfg_scale, 6.5);
  assert.equal(over.cfg_rescale, 0.2);
});
