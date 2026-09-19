import { resolveCostumeWear } from '../character/costume';
/**
 * Comic char caption: roster looks + resolved costume (not action) + pose + bubble.
 * Dialogue uses the same `korean text:문장` form as illustration speech — quoted
 * `korean text, "문장"` is what V5 garbles on the first comic page.
 *
 * closeup / cross_section cuts carry visible detail only: the prompt forbids
 * costume and wear_state there, and the roster looks (hair, clothes) must not
 * leak back in — auto-attire is what breaks close-ups.
 */
import type { CharacterRecord, ShotCharacter } from '../../core/types.ts';
import { cleanText } from '../../core/util/text.ts';
import { composeCharacterCaptionTags } from '../character/tags.ts';
import { speechCaptionTag } from '../nai/speech.ts';
import { comicCutHidesLooks } from './page.ts';
import { resolveComicSlotCostume } from './costume.ts';

export function comicSpeechCaption(bubble: unknown, text: unknown): string {
  const tag = speechCaptionTag(text);
  if (!tag) return '';
  const kind = cleanText(bubble, 40).toLowerCase();
  if (kind === 'thought' || kind === 'think') {
    return tag.replace(/^speechbubble,/, 'thought bubble,');
  }
  if (kind === 'narration' || kind === 'narrator' || kind === 'box') {
    return tag.replace(/^speechbubble,/, 'narration box,');
  }
  return tag;
}

export function composeComicSlotCaption(
  stored: Partial<CharacterRecord> | null | undefined,
  slot: ShotCharacter & { bubble?: unknown },
): string {
  // Zoomed cuts: action + interaction + speech only. Passing null roster drops
  // looks, costume, and wear — the prompt already forbids them per cut.
  if (comicCutHidesLooks((slot as { cut_kind?: unknown }).cut_kind)) {
    const looks = composeCharacterCaptionTags(null, {
      action: slot.action,
      source: slot.source,
      target: slot.target,
      mutual: slot.mutual,
      sex: slot.sex,
    });
    const speech = comicSpeechCaption(slot.bubble, slot.speech || slot.text);
    if (!speech) return looks;
    return looks ? `${looks}, ${speech}` : speech;
  }
  const wear = resolveComicSlotCostume(stored, slot.costume);
  const fakeStored: Partial<CharacterRecord> = {
    ...(stored || {}),
    costumes: [{
      ...resolveCostumeWear(stored, slot.costume),
      name: '_comic',
      note: '',
      attire: wear.attire,
      bottoms: wear.bottoms || '',
      accessories: wear.accessories,
    }],
    active_costume: 0,
    attire_locked: false,
    accessories_locked: false,
  };
  const looks = composeCharacterCaptionTags(fakeStored, {
    action: slot.action,
    source: slot.source,
    target: slot.target,
    mutual: slot.mutual,
    costume: '_comic',
    appearance: slot.appearance,
    sex: slot.sex,
    wear_state: slot.wear_state,
    nude: slot.nude,
  });
  const speech = comicSpeechCaption(slot.bubble, slot.speech || slot.text);
  // Dialogue commas must survive; joinTags would split `korean text:안돼, 가지마`.
  if (!speech) return looks;
  return looks ? `${looks}, ${speech}` : speech;
}
