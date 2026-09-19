/**
 * Models-tab LLM card HTML + DOM read helpers for the frozen UI
 * (`globalThis.__INLAY_LLM__`). Keeps vendor patches thin.
 */
import type { LlmRoleSettings, LlmSettings } from '../core/types.ts';
import {
  LLM_PROVIDERS,
  defaultEndpointForProvider,
  llmModelPlaceholder,
  normalizeLlmProvider,
  type LlmProvider,
} from '../providers/llm/providers.ts';
import { defaultLlmRoleSettings, normalizeLlmFollowMain } from '../domain/llm/roles.ts';

export function escapeLlmHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LlmCardRenderOpts {
  /** DOM id prefix, e.g. `nx-llm` or `nx-llm-autotag`. */
  prefix: string;
  title: string;
  subtitle?: string;
  /** When true, source select includes 「태깅 LLM 따라가기」. */
  allowFollowMain?: boolean;
  settings: Partial<LlmSettings & LlmRoleSettings> | null | undefined;
  /** Hide the whole card (inactive subtab). */
  hidden?: boolean;
  /** Pre-rendered test result HTML from vendor `$t(key)` (keeps prior result across re-renders). */
  testResultHtml?: string;
}

function sourceValue(s: Partial<LlmSettings & LlmRoleSettings> | null | undefined, allowFollow: boolean): string {
  if (allowFollow && normalizeLlmFollowMain((s as LlmRoleSettings | undefined)?.follow_main)) {
    return 'follow_main';
  }
  const src = String(s?.source || 'custom');
  if (src === 'main' || src === 'aux' || src === 'memory' || src === 'translate' || src === 'emotion' || src === 'other') {
    return src;
  }
  return 'custom';
}

/** One model-card for main or a secondary role. */
export function renderLlmRoleCardHtml(opts: LlmCardRenderOpts): string {
  const h = escapeLlmHtml;
  const prefix = opts.prefix || 'nx-llm';
  const allowFollow = !!opts.allowFollowMain;
  const raw = opts.settings && typeof opts.settings === 'object' ? opts.settings : {};
  const follow = allowFollow && normalizeLlmFollowMain((raw as LlmRoleSettings).follow_main);
  const llmSource = sourceValue(raw, allowFollow);
  const providerRaw = String(raw.provider || 'openrouter');
  const f = normalizeLlmProvider(providerRaw) as LlmProvider;
  const providers = LLM_PROVIDERS;
  const reasoning = String(raw.reasoning_effort || 'default');
  const vertexOn = f === 'vertex';
  const anthropicOn = f === 'anthropic_compatible';
  const openrouterish = f === 'openrouter' || f === 'openai' || f === 'custom';
  const credOk = vertexOn
    ? !!(raw.service_account_configured || raw.api_key_configured)
    : !!raw.api_key_configured;
  const customSource = llmSource === 'custom';
  const fieldsOn = !follow && customSource;
  const risuSrc = llmSource === 'main' || llmSource === 'aux'
    || llmSource === 'memory' || llmSource === 'translate'
    || llmSource === 'emotion' || llmSource === 'other';
  const active = follow
    || risuSrc
    || !!(String(raw.model || '').trim() && (credOk || String(raw.endpoint || '').trim()));
  const epPh = defaultEndpointForProvider(f, { region: String(raw.vertex_region || 'us-central1') })
    || 'https://openrouter.ai/api/v1/chat/completions';
  const modelPh = llmModelPlaceholder(f) || 'model-id';
  const badgeSrc = follow
    ? '메인 따라가기'
    : llmSource === 'main'
      ? 'Risu 메인'
      : llmSource === 'aux'
        ? 'Risu 보조'
        : llmSource === 'memory'
          ? 'Risu 장기기억'
          : llmSource === 'translate'
            ? 'Risu 번역'
            : llmSource === 'emotion'
              ? 'Risu 감정'
              : llmSource === 'other'
                ? 'Risu 기타'
                : `${vertexOn ? 'Service Account' : 'API key'} ${credOk ? '설정됨' : '없음'}`;
  const dis = fieldsOn ? '' : 'disabled';
  const hide = opts.hidden ? 'display:none' : '';
  const sourceLabel = allowFollow ? '모델 소스' : '태깅 모델 소스';
  // Matches vendor `je(key)` / `$t(key)` → `#nx-test-result-${key}` / `#nx-test-${key}` for the button.
  const testKey = prefix === 'nx-llm' ? 'llm' : prefix.replace(/^nx-/, '');
  const testBtnId = `nx-test-${testKey}`;
  const testResult =
    opts.testResultHtml
    || `<span id="nx-test-result-${testKey}" class="test-result"></span>`;

  const reasoningOpts = [
    ['default', '기본값 (모델 기본)'],
    ['none', 'none · 추론 끔'],
    ['minimal', 'minimal'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'xhigh'],
    ['max', 'max'],
  ].map(([val, lab]) => `<option value="${val}" ${reasoning === val ? 'selected' : ''}>${lab}</option>`).join('');

  return `
        <article class="model-card" data-llm-prefix="${h(prefix)}" style="${hide}">
          <div class="model-head">
            <div><div class="prompt-title">${h(opts.title)}</div><div class="muted">${h(opts.subtitle || 'OpenRouter · OpenAI · Google · Vertex · Anthropic · 로컬 · Risu')}</div></div>
            <span class="badge ${active ? 'custom' : 'default'}">${active ? '활성' : '비활성'} · ${h(badgeSrc)}</span>
          </div>
          <div class="notice info" style="margin:12px 0 0"><strong>소스</strong>에서 Risu 메인/보조를 고르면 플러그인 키가 필요 없습니다.${allowFollow ? ' 「태깅 LLM 따라가기」는 메인 태깅 설정을 그대로 씁니다.' : ''} 직접 입력일 때 Provider를 바꾸면 Endpoint가 기본값으로 바뀝니다.</div>
          <div class="model-form">
            <label class="wide"><span>${sourceLabel}</span>
              <select id="${prefix}-source" data-llm-source="1">
                ${allowFollow ? `<option value="follow_main" ${follow ? 'selected' : ''}>태깅 LLM 따라가기</option>` : ''}
                <option value="custom" ${llmSource === 'custom' ? 'selected' : ''}>직접 입력 (엔드포인트 + 키)</option>
                <option value="main" ${llmSource === 'main' ? 'selected' : ''}>Risu 메인 모델</option>
                <option value="aux" ${llmSource === 'aux' ? 'selected' : ''}>Risu 보조 모델</option>
                <option value="memory" ${llmSource === 'memory' ? 'selected' : ''}>Risu 보조모델/장기기억</option>
                <option value="translate" ${llmSource === 'translate' ? 'selected' : ''}>Risu 보조모델/번역</option>
                <option value="emotion" ${llmSource === 'emotion' ? 'selected' : ''}>Risu 보조모델/감정</option>
                <option value="other" ${llmSource === 'other' ? 'selected' : ''}>Risu 보조모델/기타</option>
              </select>
            </label>
            <label><span>Provider</span>
              <select id="${prefix}-provider" ${dis}>
                ${providers.map((opt) => `<option value="${h(opt.value)}" ${f === opt.value ? 'selected' : ''}>${h(opt.label)}</option>`).join('')}
              </select>
            </label>
            <label><span>Model</span><input id="${prefix}-model" value="${h(raw.model || '')}" placeholder="${h(modelPh)}" ${dis}></label>
            <label class="wide"><span>Endpoint${vertexOn || f === 'google_ai' || anthropicOn ? ' (비워두면 기본값)' : ''}</span><input id="${prefix}-endpoint" type="url" value="${h(raw.endpoint || '')}" placeholder="${h(epPh)}" ${vertexOn || !fieldsOn ? 'disabled' : ''}></label>
            ${vertexOn ? `<label><span>Region</span><input id="${prefix}-vertex-region" value="${h(raw.vertex_region || 'us-central1')}" placeholder="us-central1" ${dis}></label>` : `<input id="${prefix}-vertex-region" type="hidden" value="${h(raw.vertex_region || 'us-central1')}">`}
            ${vertexOn
    ? `<label class="wide"><span>Service Account JSON <span class="key-status">${raw.service_account_configured ? '설정됨' : '없음'}</span></span><textarea id="${prefix}-service-account" rows="4" autocomplete="off" placeholder='{"client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...","project_id":"..."}' ${dis}></textarea></label><label class="check wide"><input id="${prefix}-clear-sa" type="checkbox" ${dis}> 저장된 Service Account JSON 지우기</label><label class="wide"><span>Access token (선택) <span class="key-status">${raw.api_key_configured ? '설정됨' : '없음'}</span></span><input id="${prefix}-key" type="password" autocomplete="new-password" placeholder="SA 대신 Bearer access token을 쓸 때만" ${dis}></label>`
    : `<label class="wide"><span>API key <span class="key-status">${raw.api_key_configured ? '설정됨' : '없음'}</span></span><input id="${prefix}-key" type="password" autocomplete="new-password" placeholder="비워 두면 기존 키 유지" ${dis}></label><textarea id="${prefix}-service-account" style="display:none"></textarea><input id="${prefix}-clear-sa" type="checkbox" style="display:none">`}
            ${anthropicOn ? `<label><span>Anthropic version</span><input id="${prefix}-anthropic-version" value="${h(raw.anthropic_version || '2023-06-01')}" placeholder="2023-06-01" ${dis}></label>` : `<input id="${prefix}-anthropic-version" type="hidden" value="${h(raw.anthropic_version || '2023-06-01')}">`}
            <label><span>Temperature</span><input id="${prefix}-temp" type="number" min="0" max="${anthropicOn ? 1 : 2}" step="0.01" value="${h(raw.temperature ?? 0.4)}" ${dis}></label>
            <label><span>Max tokens</span><input id="${prefix}-max" type="number" min="64" max="128000" value="${h(raw.max_tokens ?? 8000)}" ${dis}></label>
            ${openrouterish || f === 'google_ai' || vertexOn
    ? `<label><span>Reasoning (추론)</span>
              <select id="${prefix}-reasoning" ${dis}>
                ${reasoningOpts}
              </select>
            </label>`
    : `<input id="${prefix}-reasoning" type="hidden" value="${h(reasoning)}">`}
          </div>
          <div class="muted model-hint">OpenRouter Reasoning은 지원 모델에만 적용됩니다. Provider를 바꾸면 알려진 기본 Endpoint로 자동 교체되고, 직접 고친 커스텀 URL은 유지합니다.</div>
          <div class="model-actions"><button type="button" id="${testBtnId}" data-llm-test="${h(testKey)}" data-llm-prefix="${h(prefix)}">${h(opts.title)} 연결 테스트</button>${testResult}</div>
        </article>`;
}

export interface DomLlmReaders {
  get: (id: string) => string;
  checked: (id: string) => boolean;
  has: (id: string) => boolean;
}

/** Read one LLM card from the dashboard DOM into a patch object. */
export function readLlmRoleFromDom(
  readers: DomLlmReaders,
  prefix: string,
  opts: { allowFollowMain?: boolean } = {},
): Record<string, unknown> {
  const { get, checked, has } = readers;
  if (!has(`${prefix}-source`) && !has(`${prefix}-model`)) {
    return opts.allowFollowMain ? { ...defaultLlmRoleSettings() } : {};
  }
  const srcRaw = get(`${prefix}-source`) || 'custom';
  if (opts.allowFollowMain && (srcRaw === 'follow_main' || srcRaw === 'follow')) {
    return { follow_main: true, source: 'custom' };
  }
  const out: Record<string, unknown> = {
    source: srcRaw === 'main' || srcRaw === 'aux' || srcRaw === 'memory'
      || srcRaw === 'translate' || srcRaw === 'emotion' || srcRaw === 'other'
      ? srcRaw
      : 'custom',
    provider: get(`${prefix}-provider`),
    model: get(`${prefix}-model`),
    endpoint: get(`${prefix}-endpoint`),
    temperature: Number(get(`${prefix}-temp`) || 0.4),
    max_tokens: Number(get(`${prefix}-max`) || 8000),
    reasoning_effort: get(`${prefix}-reasoning`) || 'default',
    vertex_region: get(`${prefix}-vertex-region`) || 'us-central1',
    anthropic_version: get(`${prefix}-anthropic-version`) || '2023-06-01',
  };
  if (opts.allowFollowMain) out.follow_main = false;
  const key = get(`${prefix}-key`);
  if (key) out.api_key = key;
  const sa = get(`${prefix}-service-account`);
  if (sa) out.service_account_json = sa;
  if (checked(`${prefix}-clear-sa`)) out.clearServiceAccount = true;
  return out;
}

/** Subtab bar HTML for models LLM roles. */
export function renderLlmRoleTabsHtml(active: string): string {
  const tabs = [
    { id: 'main', label: '메인 태깅' },
    { id: 'autotag', label: '오토태그' },
    { id: 'asset_char', label: '에셋캐릭' },
    { id: 'comic', label: '만화생성' },
    { id: 'curator', label: 'FISHTTS' },
  ];
  const cur = tabs.some((t) => t.id === active) ? active : 'main';
  return `<div class="nx-seg" id="nx-llm-role-tabs" style="margin:0 0 12px;flex-wrap:wrap">
    ${tabs.map((t) => `<button type="button" data-llm-role="${t.id}" class="${cur === t.id ? 'active' : ''}">${t.label}</button>`).join('')}
  </div>`;
}
