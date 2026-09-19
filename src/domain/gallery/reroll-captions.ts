/**
 * Viewer / long-press reroll: keep the file's character captions.
 * Rebuild from the live roster only when a slot prompt is empty.
 */
import type { CharacterInput } from '../character/identity.ts';
import { composeCharacterCaptionTags } from '../character/tags.ts';
import { resolveCharacter } from '../character/roster.ts';
import { slimCardCharacters } from './slim-cast.ts';
import { speechCaptionTag } from '../nai/speech.ts';
import { cleanText, joinTags } from '../../core/util/text.ts';
import type { NaiSceneChar } from '../nai-meta/replay.ts';

export function illustrationCaptionsFromCast(
  chars: unknown,
  roster: CharacterInput[] | null | undefined,
): NaiSceneChar[] {
  const slots = slimCardCharacters(chars);
  return slots.map((slot) => {
    const name = cleanText(slot.name, 200);
    const stored = name ? resolveCharacter(name, roster) : null;
    const raw = slot.raw && typeof slot.raw === 'object' ? slot.raw as Record<string, unknown> : {};
    const shot = { ...raw, ...slot };
    let prompt = joinTags(composeCharacterCaptionTags(stored, shot)) || 'girl';
    const tag = speechCaptionTag(shot.speech, shot.speech_lang);
    if (tag && !/speechbubble/i.test(prompt)) prompt = `${prompt}, ${tag}`;
    return {
      prompt,
      uc: cleanText(shot.uc, 4000),
      center_x: Number(slot.center_x ?? 0.5),
      center_y: Number(slot.center_y ?? 0.5),
    };
  });
}

function overrideCharacters(
  ovChars: unknown[],
  prev: NaiSceneChar[],
  limit: number,
): NaiSceneChar[] {
  return ovChars.slice(0, limit).map((ch, i) => {
    const c = (ch && typeof ch === 'object' ? ch : {}) as Record<string, unknown>;
    const last = prev[i];
    return {
      prompt: cleanText(c.prompt, 8000) || last?.prompt || 'girl',
      uc: cleanText(c.uc, 4000) || last?.uc || '',
      center_x: Number(c.center_x ?? last?.center_x ?? 0.5),
      center_y: Number(c.center_y ?? last?.center_y ?? 0.5),
    };
  });
}

/** Prefer image-file captions. Empty prompt → roster rebuild for that slot only. Comic never consults the roster. */
export function resolveRerollCharacters(args: {
  comic: boolean;
  sceneChars: NaiSceneChar[];
  stored: unknown;
  fromMeta: unknown;
  roster: CharacterInput[] | null | undefined;
  overrideChars?: unknown[] | null;
  overrideHasPrompts?: boolean;
  limit?: number;
}): NaiSceneChar[] {
  const limit = Math.max(1, Math.min(6, args.limit || 6));
  if (args.overrideHasPrompts && args.overrideChars) {
    return overrideCharacters(args.overrideChars, args.sceneChars, limit);
  }
  if (args.comic) return args.sceneChars.slice(0, limit);

  const source = (Array.isArray(args.fromMeta) && args.fromMeta.length) ? args.fromMeta : args.stored;
  const rebuilt = illustrationCaptionsFromCast(source, args.roster);
  const scene = args.sceneChars.slice(0, limit);
  if (!scene.length) return rebuilt.slice(0, limit);
  return scene.map((c, i) => {
    if (cleanText(c.prompt)) return c;
    return rebuilt[i] || { ...c, prompt: 'girl' };
  });
}
