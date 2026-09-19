import test from "node:test";
import assert from "node:assert/strict";
import {
  assignGalleryExportFiles,
  buildStoreZip,
  parseStoreZip,
  buildGalleryManifest,
  galleryImageExt,
  lookupZipImage,
  originalGalleryFileName,
  resolveReattach,
  stripExportSeqPrefix,
  unpackGalleryZip,
  withGalleryExt,
  crc32,
} from "../.test-build/gallery-zip.mjs";

test("crc32 known value", () => {
  // CRC of empty is 0
  assert.equal(crc32(new Uint8Array()), 0);
});

test("store zip marks UTF-8 names so Windows does not mojibake Hangul", () => {
  const zip = buildStoreZip([
    { name: "노겜노라/000001_노겜노라_msg1_s1.png", data: new Uint8Array([1, 2, 3]) },
  ]);
  const flags = zip[6] | (zip[7] << 8);
  assert.equal(flags, 0x0800);
  const extraLen = zip[28] | (zip[29] << 8);
  assert.equal(extraLen, 0);
  const map = parseStoreZip(zip);
  assert.ok(map.has("노겜노라/000001_노겜노라_msg1_s1.png"));
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

test("newest image in a folder is 000001_ plus the old download name", () => {
  const rows = assignGalleryExportFiles([
    { id: "old", folder_key: "c|t", character_name: "노겜노라", chat_name: "new chat2", message_index: 1, shot_index: 0, created_at: 10 },
    { id: "new", folder_key: "c|t", character_name: "노겜노라", message_index: 9, shot_index: 2, created_at: 99, chat_name: "new chat2" },
  ]);
  assert.equal(rows[0].id, "new");
  assert.equal(rows[0].file, "new chat2/000001_노겜노라_msg10_s3.webp");
  assert.equal(rows[1].file, "new chat2/000002_노겜노라_msg2_s1.webp");
});

test("character zip is one directory per chat", () => {
  const rows = assignGalleryExportFiles([
    { id: "a", folder_key: "c|t1", character_name: "노겜노라", chat_name: "new chat2", created_at: 2 },
    { id: "b", folder_key: "c|t2", character_name: "노겜노라", chat_name: "new chat5", created_at: 3 },
  ]);
  const dirs = [...new Set(rows.map((r) => r.file.split("/")[0]))].sort();
  assert.deepEqual(dirs, ["new chat2", "new chat5"]);
});

test("full export nests chat folders under each character", () => {
  const rows = assignGalleryExportFiles(
    [
      { id: "a", folder_key: "c1|t1", character_name: "Alice", chat_name: "room1", created_at: 2 },
      { id: "b", folder_key: "c2|t2", character_name: "Bob", chat_name: "room2", created_at: 3 },
      { id: "c", folder_key: "c1|t2", character_name: "Alice", chat_name: "room9", created_at: 4 },
    ],
    { nest: "character-chat" },
  );
  const paths = rows.map((r) => r.file.replace(/\/\d{6}_.+$/, "")).sort();
  assert.deepEqual(paths, ["Alice/room1", "Alice/room9", "Bob/room2"]);
});

test("stripExportSeqPrefix leaves old names alone", () => {
  assert.equal(stripExportSeqPrefix("노겜노라/000001_노겜노라_msg10_s3.png"), "노겜노라_msg10_s3.png");
  assert.equal(stripExportSeqPrefix("images/abc.png"), "abc.png");
  assert.equal(originalGalleryFileName({ character_name: "inlay", message_index: 0, shot_index: 0 }), "inlay_msg1_s1.webp");
  assert.equal(originalGalleryFileName({ character_name: "inlay", message_index: 0, shot_index: 0 }, "png"), "inlay_msg1_s1.png");
});

test("galleryImageExt follows the stored bytes, not the old .png name", () => {
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(galleryImageExt(webp), "webp");
  assert.equal(galleryImageExt(new Uint8Array([137, 80, 78, 71])), "png");
  assert.equal(withGalleryExt("노겜노라/000001_노겜노라_msg10_s3.png", "webp"), "노겜노라/000001_노겜노라_msg10_s3.webp");
});

test("lookupZipImage accepts prefixed, legacy, and stripped names", () => {
  const png = new Uint8Array([1]);
  const images = new Map([
    ["노겜노라/000001_노겜노라_msg10_s3.png", png],
  ]);
  assert.equal(lookupZipImage(images, { file: "노겜노라/000001_노겜노라_msg10_s3.png", id: "new" }), png);
  const legacy = new Map([["images/abc.png", png]]);
  assert.equal(lookupZipImage(legacy, { file: "images/abc.png", id: "abc" }), png);
  const stripped = new Map([["노겜노라/노겜노라_msg10_s3.png", png]]);
  assert.equal(lookupZipImage(stripped, { file: "노겜노라/000001_노겜노라_msg10_s3.png", id: "new" }), png);
  const webpNamed = new Map([["노겜노라/000001_노겜노라_msg10_s3.webp", png]]);
  assert.equal(lookupZipImage(webpNamed, { file: "노겜노라/000001_노겜노라_msg10_s3.png", id: "new" }), png);
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
