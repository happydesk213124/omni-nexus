/**
 * The four "does my configuration actually work?" probes behind the Models tab.
 *
 * Users paste these results into bug reports verbatim, so the message strings are
 * the module's real output contract — they are copied character-for-character and
 * must not be reworded or reordered.
 *
 * Two of the probes also mutate state, which is unusual for a diagnostics module:
 * `testLlm` persists the credentials the user just typed before testing them (so
 * a successful test leaves a working configuration behind), and
 * `probeNaiGenerate` retags the debug ring buffer while it runs so its events can
 * be told apart from a real job's.
 */

import { API_URL } from '../core/constants';
import { naiConnectionProbeKind } from '../domain/nai/connection-probe';
import { dbg, dbgSpan, debugSnapshot, setJobContext } from '../core/debug';
import { hostHas } from '../core/host';
import type { ApiResult } from '../core/types';
import { asU8, isPngBytes } from '../core/util/bytes';
import { deepMerge } from '../core/util/object';
import { cleanText } from '../core/util/text';
import {
  extractNaiMetadata,
  naiMetaHasPrompt,
  promptFromNaiMetadata,
  sceneFromNaiMetadata,
  styleFieldsFromNaiMetadata,
} from '../domain/nai-meta/index.ts';
import { naiFamilyOfModel } from '../domain/nai/routing';
import { comfyBaseUrl, imageBackendKind } from '../providers/comfy/client';
import { callLlm } from './llm-call';
import { normalizeLlmProvider } from '../providers/llm/providers';
import { llmConfigured, llmIsRisuSource, normalizeLlmSource } from '../providers/llm/transform';
import { generateT2i, getAnlas, getNaiQuotaDetail } from '../providers/nai/client';
import { modelToNaia, type T2iRequest } from '../providers/nai/payload';
import { allUniqueNaiTokens, maskNaiToken } from '../domain/nai/keys';
import { getConfig } from './context';
import { saveConfig, updateSettings } from './settings';
import { runVisionAutotagLook } from './vision-autotag';

/**
 * The abbreviated debug block the success paths return. `core/debug` owns the
 * ring buffer and exposes it only through `debugSnapshot()`, so the tail is taken
 * from there rather than from the array itself.
 */
function debugTail(): Record<string, unknown> {
  const snapshot = debugSnapshot();
  const events = snapshot['events'];
  return {
    last_stage: snapshot['last_stage'],
    events: Array.isArray(events) ? events.slice(-20) : [],
  };
}

/**
 * Saves the credentials in `llmOverride` onto the live settings, then runs a
 * one-token round trip. Secrets are only overwritten when non-blank, so the UI
 * can post the whole form back without clearing a stored key it never received.
 */
export async function testLlm(llmOverride: unknown): Promise<ApiResult> {
  if (llmOverride) {
    const config = getConfig();
    const llm: Record<string, unknown> = { ...(llmOverride as Record<string, unknown>) };
    if (cleanText(llm.api_key)) {
      config.llm.api_key = cleanText(llm.api_key);
      delete llm.api_key;
    } else delete llm.api_key;
    delete llm.api_key_configured;
    if (cleanText(llm.service_account_json)) {
      config.llm.service_account_json = cleanText(llm.service_account_json);
      delete llm.service_account_json;
    } else delete llm.service_account_json;
    delete llm.service_account_configured;
    if (Object.keys(llm).length) config.llm = deepMerge(config.llm, llm);
    await saveConfig();
  }
  try {
    const cfg = getConfig().llm;
    const source = normalizeLlmSource(cfg.source);
    const provider = normalizeLlmProvider(cfg.provider);
    if (source === 'custom' && !llmConfigured(cfg)) {
      return {
        ok: false,
        message: provider === 'vertex'
          ? 'Vertex AI: Model + Service Account JSON(또는 access token)이 필요합니다.'
          : '태깅 LLM Model/API key가 비어 있습니다. NovelAI 키가 아니라 태깅용 LLM 키를 넣으세요.',
      };
    }
    if (llmIsRisuSource(source) && !hostHas('runLLMModel')) {
      return { ok: false, message: 'RisuAI runLLMModel API를 사용할 수 없습니다.' };
    }
    const text = await callLlm(cfg, [{ role: 'user', content: 'Reply with exactly: ok' }], { plain: true });
    return { ok: true, message: `LLM ok (${source}): ${text.slice(0, 120)}` };
  } catch (exc) {
    return { ok: false, message: String((exc as Error)?.message || exc) };
  }
}

/**
 * Persists the posted NAI/Comfy draft, then probes only official NovelAI Anlas.
 * Comfy and non-`image.novelai.net` generate URLs skip the live probe so a
 * 서브챈/미러 key or a local workflow can be saved without a passing test.
 * Official NovelAI: a key that cannot read Anlas still reports `ok: true`.
 */
export async function testNai(naiOverride: unknown = null): Promise<ApiResult> {
  if (naiOverride && typeof naiOverride === 'object' && !Array.isArray(naiOverride)) {
    await updateSettings({ nai: naiOverride as Record<string, unknown> });
  }
  const nai = getConfig().nai;
  const probe = naiConnectionProbeKind({
    backend: imageBackendKind(nai),
    request_url: nai.request_url,
  });
  if (probe === 'comfy-skip') {
    return {
      ok: true,
      message: `ComfyUI 저장됨 · ${comfyBaseUrl(nai)} · 연결 테스트 생략`,
      debug: debugTail(),
    };
  }
  const tokens = allUniqueNaiTokens(nai);
  if (!tokens.length) return { ok: false, message: 'NAI api_key missing', debug: debugSnapshot() };
  if (probe === 'mirror-skip') {
    const url = cleanText(nai.request_url) || '(custom)';
    return {
      ok: true,
      message: `NAI 미러 URL 저장됨 · Anlas 생략 · ${url}`,
      debug: debugTail(),
    };
  }
  try {
    const parts: string[] = [];
    let firstAnlas: unknown = null;
    let firstSkip: unknown = null;
    for (const token of tokens) {
      try {
        const span = dbgSpan('nai.test.anlas');
        const anlas = await getAnlas(token);
        span.end({ message: 'anlas ok' });
        if (!firstAnlas) firstAnlas = anlas;
        parts.push(`…${maskNaiToken(token)}=${JSON.stringify(anlas)}`);
      } catch (exc) {
        if (!firstSkip) firstSkip = exc;
        dbg('nai.test.anlas', { message: String((exc as Error)?.message || exc) }, 'warn');
        parts.push(`…${maskNaiToken(token)} skip`);
      }
    }
    if (tokens.length === 1 && firstAnlas) {
      return { ok: true, message: `NAI token ok · Anlas=${JSON.stringify(firstAnlas)}`, debug: debugTail() };
    }
    if (tokens.length === 1 && firstSkip) {
      const model = modelToNaia(nai.model || 'nai-diffusion-4-5-full');
      return {
        ok: true,
        message: `NAI config present · model=${model} · anlas_skip=${(firstSkip as Error)?.message || firstSkip}`,
        debug: debugTail(),
      };
    }
    if (firstAnlas) {
      return { ok: true, message: `NAI token ok · ${parts.join(' · ')}`, debug: debugTail() };
    }
    const model = modelToNaia(nai.model || 'nai-diffusion-4-5-full');
    return {
      ok: true,
      message: `NAI config present · model=${model} · anlas_skip=${(firstSkip as Error)?.message || firstSkip}`,
      debug: debugTail(),
    };
  } catch (exc) {
    // Unreachable in practice: the inner catch already absorbs every failure.
    dbg('nai.test', { message: String((exc as Error)?.message || exc) }, 'error');
    return { ok: false, message: String((exc as Error)?.message || exc), debug: debugSnapshot() };
  }
}

/** Minimal 1-shot NAI generate to locate hang vs auth vs unzip failures. */
export async function probeNaiGenerate(): Promise<ApiResult> {
  const nai = getConfig().nai;
  const token = cleanText(nai.api_key);
  if (!token) return { ok: false, message: 'NAI api_key missing', debug: debugSnapshot() };
  const prevCtx = String(debugSnapshot()['job_ctx'] ?? '');
  setJobContext('probe-nai');
  const span = dbgSpan('nai.probe');
  try {
    dbg('nai.probe.start', { message: 'tiny generate' });
    const req: T2iRequest = {
      prompt: '1girl, solo, simple background, best quality',
      negative_prompt: 'lowres, bad quality',
      width: 512,
      height: 768,
      steps: 10,
      cfg_scale: 5,
      cfg_rescale: 0,
      sampler: 'k_euler_ancestral',
      scheduler: 'karras',
      model: modelToNaia(nai.model || 'nai-diffusion-4-5-full'),
      var_plus: false,
      characters: [],
      seed: Math.floor(Math.random() * 4294967295) || 1,
    };
    const apiUrl = cleanText(nai.request_url) || API_URL;
    // Shares the provider's generation lane, so a probe cannot collide with an
    // image the user is waiting on.
    const result = await generateT2i(token, req, apiUrl, { timeoutMs: 90000 });
    const bytes = result.raw_bytes.byteLength;
    const isPng = isPngBytes(asU8(result.raw_bytes));
    span.end({ bytes, is_png: isPng, seed: result.seed });
    return {
      ok: true,
      message: `probe ok · png=${isPng} · ${bytes}B · seed=${result.seed}`,
      bytes,
      is_png: isPng,
      seed: result.seed,
      debug: debugSnapshot(),
    };
  } catch (exc) {
    span.fail(exc);
    return { ok: false, message: String((exc as Error)?.message || exc), debug: debugSnapshot() };
  } finally {
    setJobContext(prevCtx);
  }
}

/**
 * Reads appearance / attire / accessories off a reference image with the tagging
 * LLM's vision lane.
 *
 * `threshold` is accepted and echoed for API compatibility only — it was a WD
 * tagger score cutoff, and the LLM path has no per-tag score to compare it
 * against. Note it is echoed as `Number(threshold || 0.2)`, so an explicit `0`
 * comes back as `0.2`.
 */
export async function evaluateAutotag(bytes: ArrayBuffer, threshold: number): Promise<ApiResult> {
  if (!bytes?.byteLength) throw new Error('image is empty');
  const parsed = await runVisionAutotagLook(bytes);
  const appearance = cleanText(parsed.appearance || '', 4000);
  const attire = cleanText(parsed.attire || '', 4000);
  const accessories = cleanText(parsed.accessories || '', 4000);
  const gender = cleanText(parsed.gender || '', 20);
  const text = cleanText(parsed.text || [appearance, attire, accessories].filter(Boolean).join(', '), 8000);
  if (!appearance && !attire && !accessories) {
    throw new Error('LLM이 외형/의상/악세사리 태그를 반환하지 않았습니다. 비전(이미지) 지원 모델인지 확인하세요.');
  }
  const tags = text.split(',').map((t) => t.trim()).filter(Boolean);
  dbg('autotag.done', {
    message: `gender=${gender || '-'} app=${appearance.length} attire=${attire.length} acc=${accessories.length}`,
    focus: true,
  });
  const result: Record<string, unknown> = {
    ok: true,
    appearance,
    attire,
    ...(parsed.bottoms != null ? { bottoms: cleanText(parsed.bottoms, 4000) } : {}),
    accessories,
    tags,
    text,
    count: tags.length,
    threshold: Number(threshold || 0.2),
    engine: 'llm-vision',
  };
  // Only surface optional look slots when set — keeps 1.x parity when the mock
  // returns no gender / hair / eyes.
  if (gender) result.gender = gender;
  const hairColor = cleanText(parsed.hair_color || '', 120);
  const hairStyle = cleanText(parsed.hair_style || '', 400);
  const eyeColor = cleanText(parsed.eye_color || '', 120);
  const height = cleanText(parsed.height || '', 80);
  const penisSize = cleanText(parsed.penis_size || '', 40);
  if (hairColor) result.hair_color = hairColor;
  if (hairStyle) result.hair_style = hairStyle;
  if (eyeColor) result.eye_color = eyeColor;
  if (height) result.height = height;
  if (parsed.age != null && parsed.age !== '') result.age = parsed.age;
  if (penisSize) result.penis_size = penisSize;
  return result;
}

/**
 * Build a style-preset draft from NovelAI image metadata (not vision).
 * Positive keeps artist + quality-style tags with emphasis; negative/CFG copied as-is.
 */
export async function evaluatePresetFromImage(
  bytes: ArrayBuffer,
  opts?: { filterTags?: boolean },
): Promise<ApiResult> {
  if (!bytes?.byteLength) throw new Error('image is empty');
  const meta = await extractNaiMetadata(bytes);
  if (!meta) throw new Error('이미지에서 NovelAI 메타데이터를 읽지 못했습니다. PNG/WebP NAI 원본인지 확인하세요.');
  if (!naiMetaHasPrompt(meta)) throw new Error('메타데이터에 프롬프트가 없습니다.');
  const prompt = promptFromNaiMetadata(meta, { includeCharCaptions: false });
  const filterTags = opts?.filterTags !== false;
  const fields = styleFieldsFromNaiMetadata(meta, prompt, { filterTags });
  if (filterTags && !fields.positive && !fields.negative) {
    throw new Error('프리셋에 넣을 artist/품질 태그와 네거티브가 비어 있습니다.');
  }
  const model_family = naiFamilyOfModel(sceneFromNaiMetadata(meta).model);
  dbg('preset-from-image.done', {
    message: `pos=${fields.positive.length} neg=${fields.negative.length} cfg=${fields.cfg_scale} family=${model_family} filter=${filterTags}`,
    focus: true,
  });
  return {
    ok: true,
    positive: fields.positive,
    negative: fields.negative,
    cfg_scale: fields.cfg_scale,
    cfg_rescale: fields.cfg_rescale,
    name: '이미지 프리셋',
    model_family,
  };
}

/** Per-token Anlas. Same key on V5 and V4 is one `v5/v4` row. */
export async function listNaiQuota(): Promise<ApiResult> {
  const nai = getConfig().nai;
  const { quotaTokenGroups } = await import('../domain/nai/keys');
  const rows: Array<Record<string, unknown>> = [];
  for (const group of quotaTokenGroups(nai)) {
    const family = group.families.join('/');
    const suffix = group.suffix;
    try {
      const anlas = await getNaiQuotaDetail(group.token);
      const row: Record<string, unknown> = {
        family,
        suffix,
        ok: true,
        fixed: anlas.fixed,
        purchased: anlas.purchased,
        total: anlas.total,
        opus: anlas.opus,
      };
      if (anlas.unlimitedImageGeneration) row.unlimitedImageGeneration = true;
      if (anlas.v5_usage) row.v5_usage = anlas.v5_usage;
      if (anlas.extra && Object.keys(anlas.extra).length) row.extra = anlas.extra;
      rows.push(row);
    } catch (err) {
      rows.push({
        family,
        suffix,
        ok: false,
        error: String((err as Error)?.message || err),
      });
    }
  }
  return { ok: true, keys: rows };
}

export { probeAssetNaiTags } from './asset-tags';
