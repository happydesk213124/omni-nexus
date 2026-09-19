import test from "node:test";
import assert from "node:assert/strict";

import { bytesToDataUrlAsync } from "../.test-build/bytes-util.mjs";

/** Bigger than the 200 KB async threshold so the fallback exercises its yielding loop. */
function sampleBytes(len = 260_000) {
  const u8 = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) u8[i] = (i * 31 + 7) & 0xff;
  return u8;
}

/**
 * Node has `Blob` but no global `FileReader`, so the fallback loop is the default
 * path here and the native path has to be injected.
 */
function withFileReader(impl, fn) {
  const had = "FileReader" in globalThis;
  const prev = globalThis.FileReader;
  globalThis.FileReader = impl;
  return fn().finally(() => {
    if (had) globalThis.FileReader = prev;
    else delete globalThis.FileReader;
  });
}

/** Stands in for the browser: labels the payload with the Blob's own type. */
class HonestFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buf).toString("base64")}`;
      this.onload();
    });
  }
}

/** Some hosts drop the type, which is why the prefix is rewritten rather than trusted. */
class TypelessFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:;base64,${Buffer.from(buf).toString("base64")}`;
      this.onload();
    });
  }
}

test("node runs the fallback loop because FileReader is not a global", async () => {
  assert.equal("FileReader" in globalThis, false);
  const url = await bytesToDataUrlAsync(sampleBytes(), "image/webp");
  assert.equal(url.startsWith("data:image/webp;base64,"), true);
});

test("native and fallback encodes produce the same string", async () => {
  const bytes = sampleBytes();
  const fallback = await bytesToDataUrlAsync(bytes, "image/webp");
  const native = await withFileReader(HonestFileReader, () => bytesToDataUrlAsync(bytes, "image/webp"));
  assert.equal(native, fallback);
});

test("a FileReader that loses the mime still yields the requested prefix", async () => {
  const bytes = sampleBytes(1024);
  const fallback = await bytesToDataUrlAsync(bytes, "image/png");
  const native = await withFileReader(TypelessFileReader, () => bytesToDataUrlAsync(bytes, "image/png"));
  assert.equal(native, fallback);
  assert.equal(native.startsWith("data:image/png;base64,"), true);
});

test("a broken FileReader falls back instead of failing the encode", async () => {
  const bytes = sampleBytes(2048);
  const fallback = await bytesToDataUrlAsync(bytes, "image/png");
  class Broken {
    readAsDataURL() {
      throw new Error("nope");
    }
  }
  assert.equal(await withFileReader(Broken, () => bytesToDataUrlAsync(bytes, "image/png")), fallback);

  class Erroring {
    readAsDataURL() {
      setTimeout(() => this.onerror(), 0);
    }
  }
  assert.equal(await withFileReader(Erroring, () => bytesToDataUrlAsync(bytes, "image/png")), fallback);
});

test("empty input encodes to nothing at all", async () => {
  assert.equal(await bytesToDataUrlAsync(new Uint8Array(0), "image/png"), "");
  assert.equal(await bytesToDataUrlAsync(null, "image/png"), "");
});
