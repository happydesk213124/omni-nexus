/**
 * Shared vision look tagging — same wire shape as the Models-tab 오토태그.
 * One short system prompt + one user message (text + single image). Never mix
 * chat/lore/asset soup into the multimodal payload (that path fails often).
 */
import { characterPrompt } from './character-prompt';
import { characterHasAppearance, syncGenderIntoAppearance } from '../domain/character/tags';
import { dbg } from '../core/debug';
import type { BytesLike } from '../core/util/bytes';
import { bytesToBase64Async } from '../core/util/bytes';
import { prepareAutotagImage } from '../core/util/image';
import { parseJsonLoose } from '../core/util/object';
import { cleanText } from '../core/util/text';
import { callLlm } from './llm-call';
import { normalizeLlmSource, type LlmMessage } from '../providers/llm/transform';
import { resolveLlmRole } from '../domain/llm/roles';
import { parseAutotagLookJson, type AutotagLook } from '../ui-contract/viewer-core';
import { getConfig } from './context';

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
  const prompt = await characterPrompt('single');
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
  let json: unknown;
  try { json = parseJsonLoose(raw); }
  catch (error) { throw new Error(`오토태그 응답 오류 · ${String((error as Error).message)}`); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('오토태그 응답 오류 · 캐릭터 JSON 객체가 필요합니다.');
  const parsed = parseAutotagLookJson(JSON.stringify(json));
  if (
    !characterHasAppearance(parsed)
    && !cleanText(parsed.attire)
    && !cleanText(parsed.bottoms)
    && !cleanText(parsed.accessories)
    && !cleanText(parsed.hair_color)
    && !cleanText(parsed.hair_style)
    && !cleanText(parsed.eye_color)
  ) {
    throw new Error('이미지 분석 결과에 외형·의상 태그가 없습니다. 모델 응답을 확인하세요.');
  }
  parsed.appearance = syncGenderIntoAppearance(parsed.appearance, parsed.gender);
  dbg('vision-autotag.done', {
    message: `gender=${parsed.gender || '-'} app=${parsed.appearance.length} attire=${parsed.attire.length} acc=${parsed.accessories.length}`,
  });
  return parsed;
}
