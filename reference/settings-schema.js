const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [name, child] of Object.entries(value)) {
    const key = name.toLowerCase();
    if (key === "api_key" || key === "auth_token" || key === "password" || key === "secret") continue;
    out[name] = redactSecrets(child);
  }
  return out;
}

export function migrateSettings(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Settings must be an object");
  const settings = clone(input);
  settings.card = settings.card && typeof settings.card === "object" && !Array.isArray(settings.card)
    ? settings.card
    : {};
  if (Number(settings.card.scale_semantics_version || 0) < 2) {
    const legacy = Number(settings.card.inline_thumb_pct);
    settings.card.inline_thumb_pct = Number.isFinite(legacy) ? Math.max(1, legacy / 6) : 100;
    settings.card.scale_semantics_version = 2;
  }
  // Sticky pin: prefer stored %; mark unit/origin so clients and future merges stay consistent.
  const hasPinPct =
    Number.isFinite(Number(settings.card.overlay_x_pct)) ||
    Number.isFinite(Number(settings.card.overlay_y_pct));
  if (hasPinPct || settings.card.overlay_pin_unit === "pct") {
    settings.card.overlay_pin_unit = "pct";
    const origin = String(settings.card.overlay_pin_origin || "");
    if (!origin || origin === "bottom-left") settings.card.overlay_pin_origin = "bl";
  }
  // lore_extra: boolean → "tags" | "full" | "off"
  const loreExtra = settings.card.lore_extra;
  if (loreExtra === true || loreExtra === "true" || loreExtra === "sections") settings.card.lore_extra = "tags";
  else if (loreExtra === false || loreExtra === "false" || loreExtra === "none") settings.card.lore_extra = "off";
  else if (loreExtra === "full" || loreExtra === "tags" || loreExtra === "off") settings.card.lore_extra = loreExtra;
  else settings.card.lore_extra = "tags";
  // Left-line overlay + always-on image are one feature: overlay_markers is canonical.
  const overlayOn = settings.card.overlay_markers !== false;
  settings.card.overlay_markers = overlayOn;
  settings.card.inline_previews = overlayOn;
  settings.settings_schema_version = 2;
  return settings;
}

export function exportSettings(input) {
  return JSON.stringify(redactSecrets(migrateSettings(input)), null, 2);
}

export function importSettings(text) {
  if (typeof text !== "string") throw new TypeError("Settings JSON must be text");
  if (text.length > 2_000_000) throw new RangeError("Settings JSON is too large");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Settings JSON must contain an object");
  return migrateSettings(parsed);
}
