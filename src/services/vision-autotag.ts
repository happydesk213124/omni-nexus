/**
 * Shared vision look tagging — same wire shape as the Models-tab 오토태그.
 * One short system prompt + one user message (text + single image). Never mix
 * chat/lore/asset soup into the multimodal payload (that path fails often).
 */
import { dbg } from '../core/debug';
import type { BytesLike } from '../core/util/bytes';
import { bytesToBase64Async } from '../core/util/bytes';
import { prepareAutotagImage } from '../core/util/image';
import { cleanText, stripCbs } from '../core/util/text';
import { callLlm } from './llm-call';
import { normalizeLlmSource, type LlmMessage } from '../providers/llm/transform';
import { resolveLlmRole } from '../domain/llm/roles';
import { parseAutotagLookJson, type AutotagLook } from '../ui-contract/viewer-core';
import { getConfig } from './context';
import { getPrompt } from './settings';

const FALLBACK_AUTOTAG = [
  'Tag ONE character reference image into Danbooru-style English prompts.',
  'Return ONE JSON object only with gender, hair_color, hair_style, eye_color, height, age, penis_size, appearance, attire, bottoms, accessories (plus name/aliases/original when known).',
  'gender is girl, boy, or other (animals/creatures). appearance = leftovers not already in hair/eye slots. attire = upper clothing + jewelry. bottoms = lower clothing. accessories = weapons/bags/held props.',
].join('\n');

/** Autotag-shaped vision call for one image. Throws on empty/failed looks. */
export async function runVisionAutotagLook(
  imageBytes: BytesLike,
  opts: { loreRef?: string } = {},
): Promise<AutotagLook> {
  const prepared = await prepareAutotagImage(imageBytes);
  const u8 = prepared.bytes;
  if (!u8.length) throw new Error('image is empty');
  const mime = prepared.mime || 'image/png';
  const filename = prepared.filename || 'image.png';
  const b64 = await bytesToBase64Async(u8);
  const dataUrl = `data:${mime};base64,${b64}`;
  const prompt = stripCbs(await getPrompt('autotag')) || FALLBACK_AUTOTAG;
  const llm = resolveLlmRole(getConfig(), 'autotag');
  dbg('vision-autotag.start', {
    message: `llm-vision ${filename} ${u8.length}B`,
    bytes: u8.length,
    source: normalizeLlmSource(llm.source),
  });
  const messages: LlmMessage[] = [
    { role: 'system', content: prompt },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: opts.loreRef
            ? `Tag this character image. JSON only with the look slots. Lore below is REFERENCE only — prefer what you see in the pixels.\n\n${opts.loreRef.slice(0, 2500)}`
            : 'Tag this character image. JSON only with the look slots (gender, hair, eyes, height, age, penis_size, appearance, attire, bottoms, accessories).',
        },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ];
  let raw = '';
  try {
    raw = await callLlm(llm, messages);
  } catch (err) {
    dbg('vision-autotag.llm.fail', { message: String((err as Error)?.message || err) }, 'error');
    throw new Error(`오토태그 LLM 실패: ${String((err as Error)?.message || err).slice(0, 240)}`);
  }
  const parsed = parseAutotagLookJson(raw);
  if (
    !cleanText(parsed.appearance)
    && !cleanText(parsed.attire)
    && !cleanText(parsed.accessories)
    && !cleanText(parsed.hair_color)
    && !cleanText(parsed.hair_style)
  ) {
    throw new Error('LLM이 외형/의상/악세사리 태그를 반환하지 않았습니다. 비전(이미지) 지원 모델인지 확인하세요.');
  }
  dbg('vision-autotag.done', {
    message: `gender=${parsed.gender || '-'} app=${parsed.appearance.length} attire=${parsed.attire.length} acc=${parsed.accessories.length}`,
  });
  return parsed;
}
