/**
 * Card cast: who + this-shot staging. Looks/clothes tags live on the roster.
 */
import { cleanText } from '../../core/util/text.ts';

const SHOT_KEYS = [
  'action',
  'speech',
  'speech_lang',
  'costume',
  'wear_state',
  'weapon',
  'center_x',
  'center_y',
  'sex',
  'expression',
  'eye_expression',
  'mouth_expression',
  'emotion',
  'gaze',
  'pose',
  'left_hand',
  'right_hand',
  'nude',
  'bubble',
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickShotFields(src: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!src) return out;
  for (const key of SHOT_KEYS) {
    if (src[key] == null || src[key] === '') continue;
    out[key] = src[key];
  }
  return out;
}

/** Drop baked prompt/look strings. Keep identity + LLM shot fields. */
export function slimCardCharacters(chars: unknown): Record<string, unknown>[] {
  if (!Array.isArray(chars)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of chars) {
    const ch = asRecord(item);
    if (!ch) continue;
    const rawIn = asRecord(ch.raw);
    const name = cleanText(ch.name ?? rawIn?.name, 200);
    const id = cleanText(ch.id ?? rawIn?.id, 80);
    const scope = cleanText(ch.scope ?? rawIn?.scope, 200);
    const shot = { ...pickShotFields(rawIn), ...pickShotFields(ch) };
    if (!name && !id && !Object.keys(shot).length) continue;
    const row: Record<string, unknown> = { ...shot };
    if (name) row.name = name;
    if (id) row.id = id;
    if (scope) row.scope = scope;
    row.raw = { ...(name ? { name } : {}), ...shot };
    out.push(row);
  }
  return out;
}
