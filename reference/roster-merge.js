/**
 * Merge per-chat session characters with globals for tagging / generation.
 *
 * Attire-only session rows (empty appearance, optional attire/accessories) must NOT
 * hide a filled global look — those rows are clothes overlays, not "incomplete" chars.
 */

export function mergeSessionAndGlobalRoster(session, globalChars, helpers = {}) {
  const list = Array.isArray(session) ? session : [];
  const globals = Array.isArray(globalChars) ? globalChars : [];
  const hasAppearance = typeof helpers.hasAppearance === "function" ? helpers.hasAppearance : () => false;
  const resolve = typeof helpers.resolve === "function" ? helpers.resolve : () => null;
  const aliasKeys = typeof helpers.aliasKeys === "function" ? helpers.aliasKeys : () => new Set();
  const normalizeName = typeof helpers.normalizeName === "function"
    ? helpers.normalizeName
    : (name) => String(name || "").trim().toLowerCase();
  const fullTags = typeof helpers.fullTags === "function" ? helpers.fullTags : () => "";
  const clean = typeof helpers.clean === "function" ? helpers.clean : (v) => String(v || "").trim();
  const globalScope = helpers.globalScope || "__global__";

  const merged = [];
  const sessionIncomplete = new Set();

  for (const schar of list) {
    if (!clean(schar?.name, 200) || hasAppearance(schar)) continue;
    // Empty chat row + filled global = attire overlay, not an incomplete blocker.
    const globalHit = resolve(schar.name, globals);
    if (globalHit && hasAppearance(globalHit)) continue;
    for (const key of aliasKeys(schar)) sessionIncomplete.add(key);
    const nameKey = normalizeName(schar.name);
    if (nameKey) sessionIncomplete.add(nameKey);
  }

  for (const gchar of globals) {
    const overlay = resolve(gchar.name, list);
    // Previously skipped globals when overlay had empty appearance — that blocked looks.
    const gKeys = aliasKeys(gchar);
    if ([...gKeys].some((k) => sessionIncomplete.has(k))) continue;
    const attire = !gchar.attire_locked && clean(overlay?.attire || "")
      ? overlay.attire
      : gchar.attire || "";
    const accessories = !gchar.accessories_locked && clean(overlay?.accessories || "")
      ? overlay.accessories
      : gchar.accessories || "";
    const attireChanged = attire !== (gchar.attire || "");
    const accChanged = accessories !== (gchar.accessories || "");
    if (overlay && (attireChanged || accChanged)) {
      merged.push({
        ...gchar,
        attire,
        accessories,
        aliases: gchar.aliases || overlay.aliases || [],
        tags: fullTags({ ...gchar, attire, accessories }),
        scope: globalScope,
      });
    } else merged.push(gchar);
  }

  for (const schar of list) {
    const hit = resolve(schar.name, merged);
    if (hit && hasAppearance(schar)) continue;
    if (hit && !hasAppearance(schar)) {
      // Keep a filled global (or merged attire overlay) — do not replace with empty session row.
      if (hasAppearance(hit)) continue;
      const idx = merged.findIndex((c) => resolve(schar.name, [c]));
      if (idx >= 0) merged[idx] = schar;
      else merged.push(schar);
      continue;
    }
    if (hit) continue;
    merged.push(schar);
  }

  return merged;
}
