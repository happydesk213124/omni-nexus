/**
 * ComfyUI local API (POST /prompt → GET /history → GET /view).
 *
 * The user supplies a raw "Export (API)" workflow with `[[placeholder]]` holes in
 * it, so most of this file is placeholder substitution rather than transport: the
 * template is text we neither wrote nor can validate ahead of time.
 */
import { dbg } from '../../core/debug.ts';
import type { ImageBackend, NaiSettings, ShotCharacter } from '../../core/types.ts';
import { Mutex, sleep } from '../../core/util/async.ts';
import { naiToComfyEmphasis } from '../../domain/prompt/nai-to-comfy.ts';
import { sniffImageMime } from '../../core/util/bytes.ts';
import { cleanText } from '../../core/util/text.ts';
import { networkFetch, readResponseBytes, type NetworkFetchOptions, type ReadBytesOptions } from '../nai/http.ts';

/** One node of an API-format workflow: `{ class_type, inputs }` keyed by node id. */
export interface ComfyNode {
  class_type?: string;
  inputs?: Record<string, unknown>;
  [key: string]: unknown;
}

export type ComfyWorkflow = Record<string, ComfyNode>;

/** Placeholder name → replacement. Numbers stay numbers when the value is a whole `[[name]]`. */
export type ComfyPlaceholderValues = Record<string, string | number>;

/** An image as `/history` reports it, which is what `/view` takes as query args. */
export interface ComfyImageRef {
  filename?: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyRequestOptions {
  signal?: AbortSignal | null;
}

export interface ComfyWaitOptions extends ComfyRequestOptions {
  timeoutMs?: number;
}

export interface JsonFetchResult<T> {
  status: number;
  data: T | null;
}

export interface ComfyPlaceholderInput {
  main: string;
  neg: string;
  captions?: readonly ShotCharacter[] | null;
  nai: NaiSettings;
  seed: number;
  /** LoadImage filename after `/upload/image`. Empty when no reference. */
  ref?: string;
}

interface ComfyPromptResponse {
  prompt_id?: unknown;
  node_errors?: unknown;
  error?: unknown;
}

interface ComfyHistoryStatus {
  status_str?: string;
  completed?: boolean;
  messages?: unknown;
}

type ComfyOutputs = Record<string, { images?: ComfyImageRef[] }>;

interface ComfyHistoryEntry {
  status?: ComfyHistoryStatus;
  outputs?: ComfyOutputs;
}

/**
 * ComfyUI queues overlapping `/prompt` submissions in an order we cannot predict,
 * so ours never overlap. 1.x shared one lock with the NovelAI lane and stole it
 * after 8s of contention; here the lock is per-backend and never stolen, because
 * every step below already has its own deadline.
 */
const generateMutex = new Mutex();

/** Which image backend the settings select. */
export function imageBackendKind(nai: Partial<NaiSettings> | null | undefined): ImageBackend {
  const b = cleanText(nai?.backend || 'nai').toLowerCase();
  return b === 'comfy' ? 'comfy' : 'nai';
}

/** Comfy ignores NAI tokens — one empty slot so the job loop still fires once. */
export function imageGenTokens(backend: ImageBackend, tokens: readonly string[]): string[] {
  if (backend === 'comfy') return [''];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const t = cleanText(raw);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Per-generation budget in ms, clamped to 30s…30min. */
export function backendTimeoutMs(nai: Partial<NaiSettings> | null | undefined): number {
  const s = Number(nai?.backend_timeout_seconds ?? 300);
  return Math.max(30, Math.min(1800, Number.isNaN(s) ? 300 : s)) * 1000;
}

/** Drops trailing slashes so paths can be appended blindly. */
export function trimBaseUrl(url: unknown): string {
  return String(url || '').trim().replace(/\/+$/, '');
}

/** The configured ComfyUI origin, defaulting to the standard local port. */
export function comfyBaseUrl(nai: Partial<NaiSettings> | null | undefined): string {
  return trimBaseUrl(cleanText(nai?.comfy_url)) || 'http://localhost:8188';
}

/** ComfyUI needs nothing but a workflow — the URL always has a default. */
export function comfyConfigured(nai: Partial<NaiSettings> | null | undefined): boolean {
  return Boolean(cleanText(nai?.comfy_workflow_json));
}

/** JSON reader that handles both `networkFetch` response shapes (`{ok,data}` and Response-like). */
export async function fetchJsonCompat<T = unknown>(
  url: string,
  options: NetworkFetchOptions = {},
): Promise<JsonFetchResult<T>> {
  const resp = await networkFetch(url, options);
  if (resp && typeof resp === 'object' && 'ok' in resp && 'data' in resp && typeof resp.arrayBuffer !== 'function') {
    const status = Number(resp.status || (resp.ok ? 200 : 0));
    let data: unknown = resp.data;
    if (data instanceof Uint8Array) data = new TextDecoder().decode(data);
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch { /* not JSON — hand the raw text back */ }
    }
    return { status, data: data as T };
  }
  const status = Number(resp?.status || 0);
  let data: unknown = null;
  try {
    data = await (resp as { json(): Promise<unknown> }).json();
  } catch {
    try {
      data = JSON.parse(await (resp as { text(): Promise<string> }).text());
    } catch { /* neither json() nor text() gave us JSON */ }
  }
  return { status, data: data as T };
}

/** Queues a workflow and returns its prompt id. */
export async function comfySubmitPrompt(
  baseUrl: string,
  promptData: ComfyWorkflow,
  opts: ComfyRequestOptions = {},
): Promise<string> {
  const clientId = `inlay-nexus-${Math.random().toString(36).slice(2, 10)}`;
  const { status, data } = await fetchJsonCompat<ComfyPromptResponse>(`${trimBaseUrl(baseUrl)}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, prompt: promptData }),
    signal: opts.signal,
  });
  if (status >= 400 || !data?.prompt_id) {
    const detail = data ? JSON.stringify(data.node_errors || data.error || data).slice(0, 300) : '';
    throw new Error(`/prompt 제출 실패 (HTTP ${status}) ${detail}`);
  }
  return String(data.prompt_id);
}

/** Polls `/history` every 2.5s until the prompt yields an output image. */
export async function comfyWaitForImage(
  baseUrl: string,
  promptId: string,
  opts: ComfyWaitOptions = {},
): Promise<ComfyImageRef> {
  const base = trimBaseUrl(baseUrl);
  const timeoutMs = Number(opts.timeoutMs || 300000);
  const deadline = Date.now() + timeoutMs;
  let polls = 0;
  let lastErr = '';
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw new Error('이미지 대기 중단 (abort)');
    await sleep(2500);
    polls += 1;
    let entry: ComfyHistoryEntry | null = null;
    try {
      const { status, data } = await fetchJsonCompat<Record<string, ComfyHistoryEntry>>(
        `${base}/history/${promptId}`,
        { method: 'GET', signal: opts.signal },
      );
      if (status < 400 && data && data[promptId]) entry = data[promptId];
    } catch (err) {
      lastErr = String((err as Error)?.message || err);
      continue;
    }
    if (polls % 8 === 0) {
      dbg('comfy.poll', {
        message: `${polls}회 · ${Math.round((Date.now() - (deadline - timeoutMs)) / 1000)}s`,
        focus: true,
      });
    }
    if (!entry) continue;
    const st: ComfyHistoryStatus = entry.status || {};
    if (st.status_str === 'error') {
      throw new Error(`생성 실패: ${JSON.stringify(st.messages || []).slice(0, 400)}`);
    }
    const outputs: ComfyOutputs = entry.outputs || {};
    for (const nodeId of Object.keys(outputs)) {
      const images = outputs[nodeId]?.images;
      if (Array.isArray(images) && images.length) {
        return images.find((im) => (im?.type || 'output') !== 'temp') || images[0];
      }
    }
    if (st.completed) throw new Error('생성은 완료됐지만 출력 이미지가 없습니다 (SaveImage 노드 확인)');
  }
  throw new Error(`이미지 대기 타임아웃 (${Math.round(timeoutMs / 1000)}s)${lastErr ? ` · ${lastErr}` : ''}`);
}

/** Downloads the finished image bytes from `/view`. */
export async function comfyFetchViewImage(
  baseUrl: string,
  ref: ComfyImageRef | null | undefined,
  opts: ComfyRequestOptions = {},
): Promise<ArrayBuffer> {
  const qs = new URLSearchParams({
    filename: cleanText(ref?.filename, 300),
    subfolder: cleanText(ref?.subfolder, 300),
    type: cleanText(ref?.type, 40) || 'output',
  });
  const resp = await networkFetch(`${trimBaseUrl(baseUrl)}/view?${qs.toString()}`, { method: 'GET', signal: opts.signal });
  const readOpts: ReadBytesOptions = { signal: opts.signal, deadline: Date.now() + 60000 };
  if (resp && typeof resp === 'object' && 'ok' in resp && 'data' in resp && !resp.arrayBuffer) {
    const status = Number(resp.status || (resp.ok ? 200 : 0));
    if (status >= 400) throw new Error(`/view 실패 (HTTP ${status})`);
    return readResponseBytes(resp.data, readOpts);
  }
  const status = Number(resp?.status || 0);
  if (status >= 400) throw new Error(`/view 실패 (HTTP ${status})`);
  return readResponseBytes(resp, readOpts);
}

/** `[[#name]]…[[/name]]` — drops the whole block when `values[name]` is empty, else keeps the body. */
export function applyComfyConditionalBlocks(text: unknown, values: ComfyPlaceholderValues): string {
  let out = String(text || '');
  // One string can hold several blocks, so repeat until a pass stops changing it.
  for (let i = 0; i < 8; i += 1) {
    const next = out.replace(/\[\[#(\w+)\]\]([\s\S]*?)\[\[\/\1\]\]/g, (_, name: string, body: string) => {
      const v = values[name];
      const keep = v != null && String(v).trim() !== '';
      return keep ? body : '';
    });
    if (next === out) break;
    out = next;
  }
  // Tidy the blank lines left behind by removed character blocks.
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

const RISU_MUSTACHE: Record<string, 'pos' | 'neg'> = {
  risu_prompt: 'pos',
  risu_neg: 'neg',
};

function applyRisuMustache(text: string, values: ComfyPlaceholderValues): string {
  return text.replace(/\{\{\s*(risu_prompt|risu_neg)\s*\}\}/gi, (_, name: string) => {
    const key = RISU_MUSTACHE[String(name).toLowerCase()];
    return key != null ? String(values[key] ?? '') : _;
  });
}

/** Substitutes `[[name]]` and `{{risu_prompt}}` / `{{risu_neg}}` in workflow strings. */
export function substituteComfyPlaceholders(wf: ComfyWorkflow, values: ComfyPlaceholderValues): void {
  for (const node of Object.values(wf)) {
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== 'object') continue;
    for (const key of Object.keys(inputs)) {
      const val = inputs[key];
      if (typeof val !== 'string' || (!val.includes('[[') && !val.includes('{{'))) continue;
      let text = applyComfyConditionalBlocks(val, values);
      const exact = text.match(/^\[\[\s*(\w+)\s*\]\]$/);
      if (exact && exact[1] in values) {
        inputs[key] = values[exact[1]];
        continue;
      }
      text = text.replace(/\[\[\s*(\w+)\s*\]\]/g, (m, name: string) => (name in values ? String(values[name]) : m));
      inputs[key] = applyRisuMustache(text, values);
    }
  }
}

/**
 * Overwrites the numeric seeds baked into the API export with this request's seed,
 * so a workflow without a `[[seed]]` hole still varies. Matches the value already
 * substituted for `[[seed]]`.
 */
export function applyComfyRandomSeeds(wf: ComfyWorkflow, seed: unknown): void {
  const s = Number(seed) || 1;
  for (const node of Object.values(wf)) {
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== 'object') continue;
    for (const key of Object.keys(inputs)) {
      if (!/^(seed|noise_seed)$/i.test(key)) continue;
      const val = inputs[key];
      if (typeof val === 'number' && Number.isFinite(val)) {
        inputs[key] = s;
      } else if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
        inputs[key] = s;
      }
    }
  }
}

/** Builds the placeholder table a workflow can reference: prompts, dimensions, `char1`…`char6`, `ref`. */
export function buildComfyPlaceholderValues(
  { main, neg, captions, nai, seed, ref }: ComfyPlaceholderInput,
): ComfyPlaceholderValues {
  const values: ComfyPlaceholderValues = {
    pos: naiToComfyEmphasis(main),
    neg: naiToComfyEmphasis(neg),
    width: Number(nai.width ?? 832) || 832,
    height: Number(nai.height ?? 1216) || 1216,
    seed: Number(seed) || 1,
    steps: Number(nai.steps ?? 28) || 28,
    cfg: Number(nai.cfg_scale ?? 7) || 7,
    ref: cleanText(ref, 300),
  };
  for (let i = 0; i < 6; i += 1) {
    values[`char${i + 1}`] = naiToComfyEmphasis(cleanText(captions?.[i]?.prompt, 2000));
  }
  return values;
}

function extForImageBytes(bytes: ArrayBuffer): string {
  const mime = sniffImageMime(bytes);
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  return 'png';
}

/** POST /upload/image — LoadImage `image` wants the returned name. */
export async function comfyUploadImage(
  baseUrl: string,
  bytes: ArrayBuffer,
  opts: ComfyRequestOptions = {},
): Promise<string> {
  const ext = extForImageBytes(bytes);
  const filename = `inlay-ref-${Date.now()}.${ext}`;
  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(bytes)], { type: sniffImageMime(bytes) || 'image/png' }), filename);
  form.append('overwrite', 'true');
  form.append('type', 'input');
  const { status, data } = await fetchJsonCompat<{ name?: string; subfolder?: string }>(
    `${trimBaseUrl(baseUrl)}/upload/image`,
    { method: 'POST', body: form, signal: opts.signal },
  );
  const name = cleanText(data?.name, 300);
  if (status >= 400 || !name) {
    throw new Error(`ComfyUI 참조 이미지 업로드 실패 (HTTP ${status})`);
  }
  const sub = cleanText(data?.subfolder, 200);
  return sub ? `${sub}/${name}` : name;
}

/**
 * A placeholder written without quotes, as in `"seed": [[seed]]`, is invalid JSON,
 * so wrap it into the string `"[[seed]]"` before parsing.
 */
export function normalizeComfyWorkflowJsonText(raw: unknown): string {
  let text = String(raw || '');
  // bare [[name]] in a value position → "[[name]]"
  text = text.replace(/(:\s*)\[\[\s*(\w+)\s*\]\](\s*[,}\]])/g, '$1"[[$2]]"$3');
  return text;
}

/** Parses the user's API-format template, validates it, and fills in every placeholder. */
export function buildComfyWorkflowFromTemplate(templateJson: unknown, values: ComfyPlaceholderValues): ComfyWorkflow {
  const custom = cleanText(templateJson);
  if (!custom) throw new Error('ComfyUI 워크플로 JSON이 비어 있습니다. Models 탭에 API Export JSON을 붙여넣으세요.');
  let parsed: unknown;
  const normalized = normalizeComfyWorkflowJsonText(custom);
  try {
    parsed = JSON.parse(normalized);
  } catch (err) {
    const tip = /\[\[/.test(custom)
      ? ' · 팁: [[seed]] 같은 값은 반드시 "[[seed]]"처럼 따옴표로 감싸세요.'
      : '';
    throw new Error(`ComfyUI 워크플로 JSON 파싱 실패: ${String((err as Error)?.message || err).slice(0, 120)}${tip}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ComfyUI 워크플로는 API 포맷(JSON 객체, 노드ID→노드)이어야 합니다.');
  }
  let wf = parsed as ComfyWorkflow;
  if (wf.nodes && wf.links) {
    throw new Error("UI 저장 포맷 워크플로입니다. ComfyUI에서 'Export (API)'로 내보낸 JSON을 넣으세요.");
  }
  const raw = JSON.stringify(wf);
  if (!/\[\[\s*pos\s*\]\]/.test(raw) && !/\{\{\s*risu_prompt\s*\}\}/i.test(raw)) {
    throw new Error('워크플로에 [[pos]] 또는 {{risu_prompt}}가 없습니다. 긍정 프롬프트를 넣는 칸에 적어 주세요.');
  }
  wf = JSON.parse(raw) as ComfyWorkflow;
  substituteComfyPlaceholders(wf, values);
  applyComfyRandomSeeds(wf, values.seed);
  return wf;
}

/** Runs one ComfyUI generation end to end and returns `[imageBytes, seed]`. */
export async function generateViaComfy(
  nai: NaiSettings,
  main: string,
  neg: string,
  captions: readonly ShotCharacter[],
  refBytes?: ArrayBuffer | null,
): Promise<[ArrayBuffer, number]> {
  const baseUrl = comfyBaseUrl(nai);
  const timeoutMs = backendTimeoutMs(nai);
  const seed = Number(nai.seed ?? 0) || Math.floor(Math.random() * 4294967295) || 1;
  const wantsRef = /\[\[\s*ref\s*\]\]/i.test(String(nai.comfy_workflow_json || ''));
  let refName = '';
  if (wantsRef && refBytes && refBytes.byteLength > 0) {
    refName = await comfyUploadImage(baseUrl, refBytes);
  }
  const values = buildComfyPlaceholderValues({ main, neg, captions, nai, seed, ref: refName });
  const wf = buildComfyWorkflowFromTemplate(nai.comfy_workflow_json, values);
  dbg('comfy.generate.start', {
    message: baseUrl,
    prompt_len: String(main || '').length,
    chars: (captions || []).length,
    has_ref: Boolean(refName),
    nodes: Object.keys(wf).length,
    focus: true,
  });
  return generateMutex.run<[ArrayBuffer, number]>(async () => {
    const promptId = await comfySubmitPrompt(baseUrl, wf);
    dbg('comfy.generate.submitted', { message: promptId.slice(0, 8), focus: true });
    const ref = await comfyWaitForImage(baseUrl, promptId, { timeoutMs });
    const bytes = await comfyFetchViewImage(baseUrl, ref);
    dbg('comfy.generate.done', { bytes: bytes?.byteLength || 0, focus: true });
    if (!bytes || bytes.byteLength < 256) {
      throw new Error(`ComfyUI 응답 이미지가 너무 짧음 (${bytes?.byteLength || 0}B)`);
    }
    return [bytes, seed];
  });
}
