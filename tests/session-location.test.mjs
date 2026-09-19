import test from "node:test";
import assert from "node:assert/strict";
import { applyLocationContinuityToShots, formatPrevLocationLine } from "../.test-build/session-location.mjs";
import { parseSessionAuthorNote } from "../.test-build/session-note.mjs";
import { parseComicPages, attachInlineComicPages } from "../.test-build/comic-page.mjs";

test("formatPrevLocationLine is short English", () => {
  assert.equal(formatPrevLocationLine(""), "prev_location: (none)");
  assert.equal(
    formatPrevLocationLine("tatami, lantern, indoor"),
    "prev_location: tatami, lantern, indoor",
  );
});

test("applyLocationContinuityToShots inherits then updates", () => {
  const shots = [
    { location: "" },
    { location: "street, night, outdoor" },
    {},
  ];
  const last = applyLocationContinuityToShots(shots, "inn, indoor");
  assert.equal(shots[0].location, "inn, indoor");
  assert.equal(shots[1].location, "street, night, outdoor");
  assert.equal(shots[2].location, "street, night, outdoor");
  assert.equal(last, "street, night, outdoor");
});

test("parseSessionAuthorNote reads location", () => {
  assert.equal(parseSessionAuthorNote({ prefix: "a", location: "hall, indoor" }).location, "hall, indoor");
});

test("parseComicPages + attach copies page location onto the shot", () => {
  const pages = parseComicPages({
    pages: [{
      location: "alley, rain, outdoor",
      cuts: [{
        cut_kind: "normal",
        base: "alley, rain, outdoor, standing, 테아, coat, 카엘, shirt",
        characters: [
          { name: "테아", action: "stand" },
          { name: "카엘", action: "stand" },
        ],
      }],
    }],
  });
  assert.equal(pages[0].location, "alley, rain, outdoor");
  const shots = [{
    kind: "comic",
    location: "inn, indoor",
    characters: [{ name: "테아" }],
    comic_page: pages[0],
  }];
  attachInlineComicPages(shots);
  assert.equal(shots[0].location, "alley, rain, outdoor");
});
