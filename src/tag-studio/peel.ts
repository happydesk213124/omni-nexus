/**
 * Split a baked NAI prompt into studio fields (preset / person / quality / remainder).
 */
import { QUALITY_TAGS } from '../config/defaults.ts';
import { splitLookTags } from '../domain/character/tags.ts';
import { cleanText, joinTags, splitTagTokens } from '../core/util/text.ts';

export interface StylePresetLike {
  id?: unknown;
  name?: unknown;
  positive?: unknown;
  negative?: unknown;
}

export interface PeelPresetHit {
  id: string;
  name: string;
  positive: string;
  negative: string;
  rest: string;
}

/** Comma/space normalize only — do not dedupe, or a preset blob may fail to match. */
export function normalizeTagBlob(text: unknown): string {
  return splitTagTokens(text).join(', ');
}

export function peelPreset(main: unknown, presets: StylePresetLike[] | null | undefined): PeelPresetHit {
  const blob = normalizeTagBlob(main);
  let hit: { id: string; name: string; positive: string; negative: string } | null = null;
  for (const raw of presets || []) {
    if (!raw || typeof raw !== 'object') continue;
    const id = cleanText(raw.id, 120);
    const positive = normalizeTagBlob(raw.positive);
    if (!id || !positive) continue;
    if (blob.includes(positive) && (!hit || positive.length > hit.positive.length)) {
      hit = {
        id,
        name: cleanText(raw.name, 200),
        positive,
        negative: normalizeTagBlob(raw.negative),
      };
    }
  }
  if (!hit) return { id: '', name: '', positive: '', negative: '', rest: blob };
  return { ...hit, rest: normalizeTagBlob(blob.replace(hit.positive, '')) };
}

export function peelPerson(main: unknown): { person: string; weight: string; rest: string } {
  const text = String(main || '');
  const weighted = text.match(/^(\d+(?:\.\d+)?)::([\s\S]*?)::(?:,\s*)?/);
  if (weighted && /(?:solo|\d+girls?|\d+boys?|\d+people)/i.test(weighted[2] || '')) {
    return {
      person: String(weighted[2] || '').trim(),
      weight: weighted[1] || '0',
      rest: normalizeTagBlob(text.slice(weighted[0].length)),
    };
  }
  const bare = text.match(/^((?:solo|\d+girls?|\d+boys?|\d+people)(?:,\s*(?:\d+girls?|\d+boys?))?)(?:,\s*)?/i);
  if (!bare) return { person: '', weight: '', rest: normalizeTagBlob(text) };
  return {
    person: bare[1] || '',
    weight: '0',
    rest: normalizeTagBlob(text.slice(bare[0].length)),
  };
}

export function peelQuality(main: unknown, qualityBlobs: string[] = Object.values(QUALITY_TAGS)): {
  quality: boolean;
  rest: string;
} {
  const blob = normalizeTagBlob(main);
  let rest = blob;
  let quality = false;
  const sorted = qualityBlobs
    .map((q) => normalizeTagBlob(String(q || '').replace(/^,/, '')))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const q of sorted) {
    if (rest.includes(q)) {
      quality = true;
      rest = normalizeTagBlob(rest.replace(q, ''));
      break;
    }
  }
  return { quality, rest };
}

export function peelMain(main: unknown, presets: StylePresetLike[] | null | undefined): {
  preset: PeelPresetHit;
  person: string;
  personWeight: string;
  personSolo: boolean;
  personMode: '' | 'gender' | 'girls' | 'people';
  quality: boolean;
  post: string;
} {
  const preset = peelPreset(main, presets);
  const person = peelPerson(preset.rest);
  const quality = peelQuality(person.rest);
  let personMode: '' | 'gender' | 'girls' | 'people' = '';
  if (person.person) {
    personMode = /people/i.test(person.person)
      ? 'people'
      : /girls?|boys?/i.test(person.person)
        ? 'gender'
        : 'gender';
  }
  return {
    preset,
    person: person.person,
    personWeight: person.weight,
    personSolo: /solo/i.test(person.person),
    personMode,
    quality: quality.quality,
    post: quality.rest,
  };
}

const SHOT_POST_KEYS = [
  'action',
  'expression',
  'eye_expression',
  'mouth_expression',
  'emotion',
  'gaze',
  'pose',
  'left_hand',
  'right_hand',
  'sex',
  'wear_state',
  'weapon',
] as const;

export function joinSlimShotPost(slot: Record<string, unknown> | null | undefined): string {
  if (!slot) return '';
  return joinTags(...SHOT_POST_KEYS.map((key) => slot[key]));
}

export function peelLookFromCaption(caption: unknown, look: unknown): string {
  const lookKeys = new Set(splitTagTokens(look).map((t) => t.toLowerCase()));
  if (!lookKeys.size) return normalizeTagBlob(caption);
  return splitTagTokens(caption).filter((t) => !lookKeys.has(t.toLowerCase())).join(', ');
}

/** V5 bubble sits at the end of the char caption. Keep the line intact (commas in dialogue). */
const SPEECH_TAIL_RE =
  /(?:,\s*)?((?:speechbubble|thought bubble|narration box)\s*,\s*(?:korean|english|japanese)\s+text\s*:\s*[\s\S]+)$/i;

export function peelSpeechTail(caption: unknown): { body: string; speech: string } {
  const raw = String(caption || '').trim();
  const m = raw.match(SPEECH_TAIL_RE);
  if (!m || m.index == null) return { body: raw, speech: '' };
  return {
    body: raw.slice(0, m.index).replace(/[,\s]+$/, '').trim(),
    speech: String(m[1] || '').trim(),
  };
}

/** Slim shot fields + editable speech tail. Otherwise caption minus look. */
export function resolveCharPost(opts: {
  slim?: Record<string, unknown> | null;
  caption?: unknown;
  lookTags?: unknown;
}): string {
  const { body, speech } = peelSpeechTail(opts.caption);
  const fromSlim = joinSlimShotPost(opts.slim);
  const base = fromSlim || peelLookFromCaption(body, opts.lookTags);
  if (!speech) return base;
  if (/(?:speechbubble|thought bubble|narration box)/i.test(base)) return base;
  return base ? `${base}, ${speech}` : speech;
}

/** 외형 = identity. 코스튬 = clothes/jewelry/props, plus any roster attire tokens. */
export function splitLookAndCostume(lookBlob: unknown, costumeAttire: unknown): {
  tags: string;
  costumeTags: string;
} {
  const [identity, attire, accessories] = splitLookTags(lookBlob);
  const costumeKeys = new Set(splitTagTokens(costumeAttire).map((t) => t.toLowerCase()));
  const tags: string[] = [];
  const fromIdentity: string[] = [];
  for (const tok of splitTagTokens(identity)) {
    if (costumeKeys.has(tok.toLowerCase())) fromIdentity.push(tok);
    else tags.push(tok);
  }
  return {
    tags: tags.join(', '),
    costumeTags: joinTags(attire, accessories, fromIdentity.join(', ')),
  };
}

/**
 * First fill only: split a baked NAI char caption into 외형 / 코스튬 / 후행.
 * Roster look+attire are peel keys, not field values.
 */
export function peelStudioCharFields(opts: {
  slim?: Record<string, unknown> | null;
  caption?: unknown;
  lookTags?: unknown;
  costumeAttire?: unknown;
}): { tags: string; costumeTags: string; post: string } {
  const post = resolveCharPost({
    slim: opts.slim,
    caption: opts.caption,
    lookTags: opts.lookTags,
  });
  const lookPart = peelLookFromCaption(peelSpeechTail(opts.caption).body, post);
  const split = splitLookAndCostume(lookPart, opts.costumeAttire);
  return { tags: split.tags, costumeTags: split.costumeTags, post };
}
