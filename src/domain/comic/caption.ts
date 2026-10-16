import { resolveCostumeWear } from '../character/costume';
/**
 * Comic char caption: roster looks + resolved costume (not action) + pose + bubble.
 * Dialogue uses the same `korean text:문장` form as illustration speech — quoted
 * `korean text, "문장"` is what V5 garbles on the first comic page.
 *
 * Closeup normally omits roster looks; the opt-in half caption preserves the
 * looks at low strength and actual wardrobe unchanged. Cross-section keeps the original exclusion.
 */
import type { CharacterRecord, ShotCharacter } from '../../core/types.ts';
import { cleanText, splitTagTokens } from '../../core/util/text.ts';
import { composeCharacterCaptionTags, isClothingTag } from '../character/tags.ts';
import { speechCaptionTag, speechStyleFromCard, type SpeechStyle } from '../nai/speech.ts';
import { comicCutHidesLooks, normalizeComicCutKind } from './page.ts';
import { resolveComicSlotCostume } from './costume.ts';
import { weightCharacterPrompt, stripCharacterEmphasis, normalizeCharacterWeight } from '../prompt/character-weight';
import { parseWearState } from '../character/wear-state';

export function comicCloseupCharacterInstruction(enabled: boolean, weight: unknown = 0.5): string {
  return enabled
    ? `Close-up character tags ON: for closeup cuts, include costume and wear_state as continuity data even if earlier rules omit them. Preserve now_wearing and the latest clothing state unless the prose explicitly changes them; do not dress or undress a character just because the camera zooms. Do not copy roster looks into action/base; the application adds only character appearance at weight ${normalizeCharacterWeight(weight)}, preserving costume, clothing-state, action and speech weights. Cross_section exclusions remain unchanged.`
    : '';
}

export function comicSpeechCaption(bubble: unknown, text: unknown, style: SpeechStyle = {}): string {
  const kind = cleanText(bubble, 40).toLowerCase();
  const shape = kind === 'thought' || kind === 'think' ? 'thought bubble'
    : kind === 'narration' || kind === 'narrator' || kind === 'box' ? 'narration box' : 'speech bubble';
  return speechCaptionTag(text, undefined, style, shape);
}

export function composeComicSlotCaption(
  stored: Partial<CharacterRecord> | null | undefined,
  slot: ShotCharacter & { bubble?: unknown },
  options: { character_height?: unknown; character_age?: unknown; comic_closeup_character_half?: unknown; comic_closeup_character_weight?: unknown; speech_bubble_weight?: unknown; speech_huge_text?: unknown } = {},
): string {
  const half = options.comic_closeup_character_half === true
    && normalizeComicCutKind((slot as { cut_kind?: unknown }).cut_kind) === 'closeup';
  // Zoomed cuts: action + interaction + speech only. Passing null roster drops
  // looks, costume, and wear — the prompt already forbids them per cut.
  if (!half && comicCutHidesLooks((slot as { cut_kind?: unknown }).cut_kind)) {
    const looks = composeCharacterCaptionTags(null, {
      action: slot.action,
      source: slot.source,
      target: slot.target,
      mutual: slot.mutual,
      sex: slot.sex,
    });
    const speech = comicSpeechCaption(slot.bubble, slot.speech || slot.text, speechStyleFromCard(options));
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
  }, options);
  const speech = comicSpeechCaption(slot.bubble, slot.speech || slot.text, speechStyleFromCard(options));
  if (half) {
    const appearance = composeCharacterCaptionTags({ ...fakeStored, costumes: [{
      ...resolveCostumeWear(fakeStored, '_comic'), attire: '', bottoms: '', accessories: '',
    }] }, { costume: '_comic', appearance: slot.appearance, sex: slot.sex }, options);
    const keys = new Set(splitTagTokens(appearance).filter(tag => {
      const plain = stripCharacterEmphasis(tag);
      return !parseWearState(plain) && !isClothingTag(plain);
    }).map(tag => tag.toLowerCase()));
    const tags = splitTagTokens(looks);
    const leading = tags.filter(tag => keys.has(tag.toLowerCase())).join(', ');
    const tail = tags.filter(tag => !keys.has(tag.toLowerCase())).join(', ');
    return [weightCharacterPrompt(leading, options.comic_closeup_character_weight), tail, speech].filter(Boolean).join(', ');
  }
  // Dialogue commas must survive; joinTags would split `korean text:안돼, 가지마`.
  const caption = speech ? (looks ? `${looks}, ${speech}` : speech) : looks;
  return caption;
}
