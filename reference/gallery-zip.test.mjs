import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStoreZip,
  parseStoreZip,
  buildGalleryManifest,
  resolveReattach,
  unpackGalleryZip,
  crc32,
} from "../src/gallery-zip.js";

test("crc32 known value", () => {
  // CRC of empty is 0
  assert.equal(crc32(new Uint8Array()), 0);
});

test("store zip roundtrip", () => {
  const payload = new TextEncoder().encode("hello");
  const zip = buildStoreZip([
    { name: "manifest.json", data: new TextEncoder().encode('{"ok":true}') },
    { name: "images/a.png", data: payload },
  ]);
  const map = parseStoreZip(zip);
  assert.equal(new TextDecoder().decode(map.get("images/a.png")), "hello");
  assert.equal(JSON.parse(new TextDecoder().decode(map.get("manifest.json"))).ok, true);
});

test("manifest + unpack", () => {
  const items = [{ id: "abc", content_hash: "h1", character_id: "c", chat_id: "t", message_index: 2 }];
  const manifest = buildGalleryManifest(items);
  assert.equal(manifest.format, "inlay-nexus-gallery");
  assert.equal(manifest.items[0].file, "images/abc.png");
  const zip = buildStoreZip([
    { name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest)) },
    { name: "images/abc.png", data: new Uint8Array([137, 80, 78, 71]) },
  ]);
  const unpacked = unpackGalleryZip(zip);
  assert.equal(unpacked.manifest.items[0].id, "abc");
  assert.ok(unpacked.images.get("images/abc.png"));
});

test("resolveReattach exact / candidate / orphan", () => {
  const existing = [
    { id: "x", content_hash: "hh", character_id: "c1", chat_id: "ch1", message_index: 3 },
    { id: "y", content_hash: "other", character_id: "c1", chat_id: "ch1", message_index: 3 },
  ];
  assert.equal(resolveReattach({ location: { content_hash: "hh" } }, existing).status, "exact");
  assert.equal(
    resolveReattach({ location: { content_hash: "miss", character_id: "c1", chat_id: "ch1", message_index: 3 } }, existing).status,
    "candidate",
  );
  assert.equal(resolveReattach({ location: { content_hash: "zzz" } }, existing).status, "orphan");
});
