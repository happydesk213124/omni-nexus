/**
 * NovelAI image metadata → filtered tag plains for asset injection.
 */
import { asU8, isPngBytes, isWebpBytes, type BytesLike } from '../../core/util/bytes.ts';
import { naiMetaHasNegative, naiMetaHasPrompt, pickNaiMeta, promptFromNaiMetadata } from './from-metadata.ts';
import { readPngTextChunks } from './png-text.ts';
import {
  filterAssetPromptTags,
  type FilteredPromptTags,
} from './prompt-tags.ts';
import { decodePngToRgba } from './png-rgba.ts';
import { decodeImageToRgba, extractStealthFromRgba, packAlphaLsbColumnMajor } from './stealth.ts';
import { webpExifTextMap } from './webp-exif.ts';
import { readGenerationImageData } from './generation-data.ts';
export { readGenerationImageData, writeGenerationImageData, type GenerationImageData, type GenerationCharacterAssociation } from './generation-data.ts';
export { safeGenerationRecipe } from './safe-recipe.ts';

export {
  filterAssetPromptTags,
  formatAssetTagsInjectBlock,
  mergeWeightMaps,
  packAssetTagGroups,
  packedAssetNames,
  restoreAssetTagWeights,
  splitNaiPromptTokens,
  type FilteredPromptTags,
  type PackedAssetTags,
  type PackedAssetTriggerGroup,
} from './prompt-tags.ts';
export { naiMetaHasNegative, naiMetaHasPrompt, pickNaiMeta, promptFromNaiMetadata } from './from-metadata.ts';
export {
  applyNaiSceneOverrides,
  isComicNaiScene,
  modelFromNaiSource,
  randomNaiSeed,
  sceneFromNaiMetadata,
  requireNaiReplayScene,
  t2iRequestFromScene,
  type NaiScene,
  type NaiSceneChar,
} from './replay.ts';
export {
  aspectFromCanvas,
  canvasDimsForShot,
  dimsForAspect,
  generationUsesShotAspect,
  normalizeShotAspect,
  resolveShotAspect,
  ASPECT_SIZES,
  type ShotAspect,
} from './aspect.ts';
export {
  filterStylePresetPositive,
  styleFieldsFromNaiMetadata,
  type StylePresetFromMeta,
} from './style-preset.ts';

function metaFromTextMap(map: Record<string, string>): unknown {
  const comment = map.Comment || map.comment;
  if (comment) {
    try {
      return { Comment: JSON.parse(comment), ...map };
    } catch {
      return { Comment: comment, ...map };
    }
  }
  return map;
}

/** Read NAI metadata from PNG/WebP bytes (file chunks + stealth alpha). */
export async function extractNaiMetadata(bytes: BytesLike): Promise<unknown | null> {
  const u8 = asU8(bytes);
  if (!u8.length) return null;
  if (isWebpBytes(u8) || isPngBytes(u8)) {
    const internal = readGenerationImageData(u8);
    if (internal?.recipe != null) return internal.recipe;
  }

  // Text chunks first when they hold both prompt and uc. Description-only
  // (common after a file-picker re-encode) still needs stealth for `uc`.
  let textMeta: unknown | null = null;
  if (isPngBytes(u8)) {
    const texts = await readPngTextChunks(u8);
    if (texts.Comment || texts.Description || texts.Source) {
      const fromText = metaFromTextMap(texts);
      if (naiMetaHasPrompt(fromText) && naiMetaHasNegative(fromText)) return fromText;
      if (naiMetaHasPrompt(fromText)) textMeta = fromText;
    }
  } else if (isWebpBytes(u8)) {
    const texts = webpExifTextMap(u8);
    if (texts.UserComment || texts.ImageDescription) {
      const map: Record<string, string> = {};
      if (texts.UserComment) map.Comment = texts.UserComment;
      if (texts.ImageDescription) map.Description = texts.ImageDescription;
      const fromText = metaFromTextMap(map);
      if (naiMetaHasPrompt(fromText) && naiMetaHasNegative(fromText)) return fromText;
      if (naiMetaHasPrompt(fromText)) textMeta = fromText;
    }
  }

  // Raw PNG pixels first. Canvas/createImageBitmap changes alpha LSBs.
  if (isPngBytes(u8)) {
    const raw = await decodePngToRgba(u8);
    if (raw) {
      const stealth = await extractStealthFromRgba(raw.rgba, raw.width, raw.height);
      const picked = pickNaiMeta(textMeta, stealth);
      if (picked) return picked;
    }
  }

  const decoded = await decodeImageToRgba(u8);
  if (!decoded) return textMeta;
  const fromCanvas = await extractStealthFromRgba(decoded.rgba, decoded.width, decoded.height);
  return pickNaiMeta(textMeta, fromCanvas);
}

function peekKind(u8: Uint8Array): string {
  if (isPngBytes(u8)) return 'png';
  if (isWebpBytes(u8)) return 'webp';
  if (u8.length >= 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'jpeg';
  return 'other';
}

function peekPngColorType(u8: Uint8Array): number | null {
  if (!isPngBytes(u8) || u8.length < 26) return null;
  return u8[25] ?? null;
}

function asciiHead(bytes: Uint8Array, n = 16): string {
  const lim = Math.min(n, bytes.length);
  let s = '';
  for (let i = 0; i < lim; i += 1) {
    const c = bytes[i]!;
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
  }
  return s;
}

export interface NaiImageInspect {
  tags: FilteredPromptTags | null;
  kind: string;
  colorType: number | null;
  pngDecode: boolean;
  textKeys: string[];
  stealthHead: string;
  promptLen: number;
  promptSample: string;
  reason: string;
}

/** Same extract as tagsFromImageBytes, plus why it failed (debug read_log). */
export async function inspectNaiImageBytes(bytes: BytesLike): Promise<NaiImageInspect> {
  const u8 = asU8(bytes);
  const kind = peekKind(u8);
  const colorType = peekPngColorType(u8);
  let textKeys: string[] = [];
  let pngDecode = false;
  let stealthHead = '';
  if (isPngBytes(u8)) {
    textKeys = Object.keys(await readPngTextChunks(u8));
    const raw = await decodePngToRgba(u8);
    pngDecode = Boolean(raw);
    if (raw) stealthHead = asciiHead(packAlphaLsbColumnMajor(raw.rgba, raw.width, raw.height));
  }
  const meta = await extractNaiMetadata(u8);
  if (!meta) {
    return {
      tags: null,
      kind,
      colorType,
      pngDecode,
      textKeys,
      stealthHead,
      promptLen: 0,
      promptSample: '',
      reason: !pngDecode && kind === 'png' ? 'png_decode_fail' : 'no_stealth',
    };
  }
  const prompt = promptFromNaiMetadata(meta);
  if (!prompt.trim()) {
    return {
      tags: null, kind, colorType, pngDecode, textKeys, stealthHead, promptLen: 0, promptSample: '', reason: 'empty_prompt',
    };
  }
  const filtered = filterAssetPromptTags(prompt);
  if (!filtered.plains.length) {
    return {
      tags: null, kind, colorType, pngDecode, textKeys, stealthHead, promptLen: prompt.length, promptSample: prompt.slice(0, 180), reason: 'filtered_empty',
    };
  }
  return {
    tags: filtered, kind, colorType, pngDecode, textKeys, stealthHead, promptLen: prompt.length, promptSample: prompt.slice(0, 180), reason: 'ok',
  };
}

/** Full pipeline: image bytes → filtered plains + weight map. */
export async function tagsFromImageBytes(bytes: BytesLike): Promise<FilteredPromptTags | null> {
  const inspected = await inspectNaiImageBytes(bytes);
  return inspected.tags;
}
