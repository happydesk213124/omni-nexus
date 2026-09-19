/** Detect the special always-on character-image lore entry. */
export function isCharacterImageExtraLore(entry) {
  const name = String(entry?.comment || entry?.name || "").trim().toLowerCase();
  return name === "lb-xnai.lb.extra";
}

/**
 * Parse ## / ### sections from lb-xnai.lb.extra body.
 * "Character Image Tags" is the shared header; every other heading is a character section.
 */
export function parseCharacterImageTagLore(content) {
  const text = String(content || "");
  if (!text.trim()) {
    return { header: "", sections: [] };
  }
  const re = /^(#{2,3})\s+(.+?)\s*$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({
      hashes: m[1],
      title: String(m[2] || "").trim(),
      start: m.index,
      titleEnd: m.index + m[0].length,
    });
  }
  if (!matches.length) {
    return { header: text.trimEnd(), sections: [] };
  }

  let header = text.slice(0, matches[0].start).trimEnd();
  const sections = [];
  for (let i = 0; i < matches.length; i += 1) {
    const cur = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length;
    const body = text.slice(cur.titleEnd, end).replace(/^\r?\n/, "").trimEnd();
    const titleNorm = cur.title.toLowerCase();
    if (titleNorm === "character image tags") {
      const block = text.slice(cur.start, end).trimEnd();
      header = header ? `${header}\n\n${block}` : block;
      continue;
    }
    sections.push({
      title: cur.title,
      hashes: cur.hashes,
      body,
    });
  }
  return { header: header.trimEnd(), sections };
}

export function normalizeNameKey(name) {
  return String(name || "")
    .replace(/[^a-zA-Z0-9\uac00-\ud7a3\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/g, "")
    .toLowerCase();
}

function nameKeySet(names) {
  return new Set(
    (Array.isArray(names) ? names : [])
      .map((n) => normalizeNameKey(n))
      .filter(Boolean),
  );
}

function renderSections(header, sections) {
  if (!sections.length) return "";
  const parts = [];
  if (header) parts.push(header);
  for (const sec of sections) {
    const head = `${sec.hashes} ${sec.title}`;
    parts.push(sec.body ? `${head}\n${sec.body}` : head);
  }
  return parts.join("\n\n").trimEnd();
}

/**
 * Keep only character sections whose titles are in keepNames (trigger hits),
 * then drop any that are already filled in the roster.
 * filledNames should include each filled character's display name AND trigger aliases
 * (so ### Yoon Ji-soo drops when roster name is 윤지수 but aliases include "Yoon Ji-soo").
 * No keepNames / empty keep → omit entire entry (do not dump all sections).
 */
export function trimCharacterImageTagLore(content, filledNames = [], keepNames = []) {
  const parsed = parseCharacterImageTagLore(content);
  if (!parsed.sections.length) {
    // No character sections — only keep raw body if keepNames explicitly allows dump.
    // Default: without section triggers, omit unstructured blobs.
    return "";
  }
  const keep = nameKeySet(keepNames);
  if (!keep.size) return "";
  const filled = nameKeySet(filledNames);
  const kept = parsed.sections.filter((sec) => {
    const key = normalizeNameKey(sec.title);
    return keep.has(key) && !filled.has(key);
  });
  return renderSections(parsed.header, kept);
}

/**
 * Section titles to inject for lb-xnai.lb.extra.
 * A section matches when:
 * - its title appears in the message, OR
 * - its title equals any trigger alias from lore entries that already triggered
 *   (e.g. message has "윤지수" → 윤지수 lore keys include "Yoon Ji-soo" → section opens).
 */
export function matchCharacterImageSectionTitles(content, messageText, triggerAliases = []) {
  const parsed = parseCharacterImageTagLore(content);
  const hay = normalizeNameKey(messageText);
  const aliasKeys = new Set(
    (Array.isArray(triggerAliases) ? triggerAliases : [])
      .map((n) => normalizeNameKey(n))
      .filter((k) => k.length >= 2),
  );
  if (!hay && !aliasKeys.size) return [];
  const hits = [];
  for (const sec of parsed.sections) {
    const key = normalizeNameKey(sec.title);
    if (key.length < 2) continue;
    if ((hay && hay.includes(key)) || aliasKeys.has(key)) hits.push(sec.title);
  }
  return hits;
}
