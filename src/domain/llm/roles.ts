/**
 * Per-role LLM profiles: autotag / asset_char.
 * Default is follow_main → use settings.llm (main tagging).
 */
import type {
  LlmRoleId,
  LlmRoleSettings,
  LlmRolesSettings,
  LlmSettings,
  LlmSource,
} from '../../core/types.ts';

export const LLM_ROLE_IDS: readonly LlmRoleId[] = ['autotag', 'asset_char', 'comic'];

export type LlmResolveRole = 'main' | LlmRoleId;

const FOLLOW_TRUE = new Set(['true', '1', 'on', 'yes', 'follow', 'follow_main']);

function normalizeRoleSource(value: unknown): LlmSource {
  const s = String(value ?? '').toLowerCase().trim();
  if (s === 'main') return 'main';
  if (s === 'memory') return 'memory';
  if (s === 'translate' || s === 'translation') return 'translate';
  if (s === 'emotion') return 'emotion';
  if (s === 'other' || s === 'otherax' || s === 'other_ax') return 'other';
  if (s === 'aux' || s === 'secondary' || s === 'sub' || s === 'submodel') return 'aux';
  return 'custom';
}

/** True when the role should use `settings.llm`. Missing/unknown → true. */
export function normalizeLlmFollowMain(value: unknown): boolean {
  if (value === false || value === 0 || value === '0' || value === 'false' || value === 'off' || value === 'no') {
    return false;
  }
  if (value == null || value === '') return true;
  if (value === true || value === 1) return true;
  const s = String(value).toLowerCase().trim();
  if (FOLLOW_TRUE.has(s)) return true;
  if (s === 'custom' || s === 'own' || s === 'override') return false;
  return true;
}

export function defaultLlmRoleSettings(): LlmRoleSettings {
  return {
    follow_main: true,
    source: 'custom',
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: '',
    api_key: '',
    service_account_json: '',
    temperature: 0.4,
    max_tokens: 8000,
    timeout_seconds: 180,
    reasoning_effort: 'default',
    vertex_region: 'us-central1',
    anthropic_version: '2023-06-01',
  };
}

export function defaultLlmRolesSettings(): LlmRolesSettings {
  return {
    autotag: defaultLlmRoleSettings(),
    asset_char: defaultLlmRoleSettings(),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/** Merge one stored role blob onto defaults (follow_main defaults true). */
export function normalizeLlmRoleSettings(raw: unknown): LlmRoleSettings {
  const base = defaultLlmRoleSettings();
  const o = asObject(raw);
  const follow = normalizeLlmFollowMain(o.follow_main ?? o.followMain);
  const sourceRaw = o.source;
  let source: LlmSource = base.source;
  if (sourceRaw === 'follow_main' || sourceRaw === 'follow') {
    return { ...base, follow_main: true };
  }
  if (typeof sourceRaw === 'string' && sourceRaw) {
    source = normalizeRoleSource(sourceRaw);
  }
  return {
    ...base,
    ...o,
    follow_main: follow,
    source,
    provider: String(o.provider ?? base.provider),
    endpoint: String(o.endpoint ?? base.endpoint),
    model: String(o.model ?? base.model),
    api_key: typeof o.api_key === 'string' ? o.api_key : base.api_key,
    service_account_json:
      typeof o.service_account_json === 'string' ? o.service_account_json : base.service_account_json,
    temperature: Number.isFinite(Number(o.temperature)) ? Number(o.temperature) : base.temperature,
    max_tokens: Number.isFinite(Number(o.max_tokens)) ? Number(o.max_tokens) : base.max_tokens,
    timeout_seconds: Number.isFinite(Number(o.timeout_seconds))
      ? Number(o.timeout_seconds)
      : base.timeout_seconds,
    reasoning_effort: String(o.reasoning_effort ?? base.reasoning_effort),
    vertex_region: String(o.vertex_region ?? base.vertex_region),
    anthropic_version: String(o.anthropic_version ?? base.anthropic_version),
  };
}

/** Ensure all roles exist with follow_main default true. */
export function normalizeLlmRolesSettings(raw: unknown): LlmRolesSettings {
  const o = asObject(raw);
  const out = defaultLlmRolesSettings();
  for (const id of LLM_ROLE_IDS) {
    if (id === 'comic' && !o[id]) continue;
    out[id] = normalizeLlmRoleSettings(o[id]);
  }
  return out;
}

/**
 * Resolve the LlmSettings used for a call site.
 * `main` → settings.llm. Roles with follow_main (or missing) → settings.llm.
 * Own profile → role fields only (no merge with main).
 */
export function resolveLlmRole(
  settings: { llm?: LlmSettings | null; llm_roles?: unknown } | null | undefined,
  role: LlmResolveRole,
): LlmSettings {
  const main = (settings?.llm && typeof settings.llm === 'object'
    ? settings.llm
    : {}) as LlmSettings;
  if (role === 'main') return main;
  const roles = normalizeLlmRolesSettings(settings?.llm_roles);
  const profile = roles[role];
  if (!profile || profile.follow_main) return main;
  const { follow_main: _follow, ...rest } = profile;
  return rest as LlmSettings;
}
