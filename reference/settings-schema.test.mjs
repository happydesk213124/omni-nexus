import test from "node:test";
import assert from "node:assert/strict";

import {
  migrateSettings,
  exportSettings,
  importSettings,
} from "../src/settings-schema.js";

test("legacy 600 percent migrates to new 100 percent without changing visual size", () => {
  const migrated = migrateSettings({ card: { inline_thumb_pct: 600 } });
  assert.equal(migrated.card.inline_thumb_pct, 100);
  assert.equal(migrated.card.scale_semantics_version, 2);
});

test("settings export omits API keys and auth tokens", () => {
  const exported = JSON.parse(exportSettings({
    auth_token: "secret",
    llm: { api_key: "llm-secret", model: "model" },
    nai: { api_key: "nai-secret", model: "nai" },
    card: { inline_thumb_pct: 100 },
  }));

  assert.equal(exported.auth_token, undefined);
  assert.equal(exported.llm.api_key, undefined);
  assert.equal(exported.nai.api_key, undefined);
  assert.equal(exported.llm.model, "model");
  assert.equal(exported.nai.model, "nai");
});

test("malformed import rejects without producing replacement settings", () => {
  assert.throws(() => importSettings("{ nope"), /JSON/);
  assert.throws(() => importSettings("[]"), /object/i);
});

test("valid import migrates legacy scale", () => {
  const imported = importSettings(JSON.stringify({ card: { inline_thumb_pct: 300 } }));
  assert.equal(imported.card.inline_thumb_pct, 50);
  assert.equal(imported.settings_schema_version, 2);
});

test("overlay_markers and inline_previews stay synced as one feature", () => {
  const on = migrateSettings({ card: { overlay_markers: true, inline_previews: false } });
  assert.equal(on.card.overlay_markers, true);
  assert.equal(on.card.inline_previews, true);

  const off = migrateSettings({ card: { overlay_markers: false, inline_previews: true } });
  assert.equal(off.card.overlay_markers, false);
  assert.equal(off.card.inline_previews, false);
});
