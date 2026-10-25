import type { TaggerResult } from '../core/types';
import { psGet, psSet } from './device-store';

/**
 * Waiting slots (`[[@inraywait::id::w::h]]`): the shot each one will generate.
 * Kept in the save (moves with it, like settings) rather than in the chat, so a
 * baked reply stays short and nothing of it reaches the model. A slot whose row
 * is gone (another save, cleared data) still works: its line is in the message,
 * and the tagger draws it from there.
 */
export const INLINE_WAITS_KEY = 'omniinline.waits';
const LIMIT = 300;

export interface InlineWait {
  id: string;
  /** The block's shot; null when the block was broken and the tagger must draw it. */
  tagged: TaggerResult | null;
  /** The broken block as written, when tagged is null: a tap asks to fix it first. */
  raw?: string;
  /** Analysis lines before the slot. */
  line: number;
  characterId: string;
  chatId: string;
  hostMessageId: string;
  createdAt: number;
}

let rows: Map<string, InlineWait> | undefined;
let loading: Promise<Map<string, InlineWait>> | undefined;
let tail: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function parse(raw: unknown): Map<string, InlineWait> {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? (() => { try { return JSON.parse(raw) as unknown; } catch { return []; } })() : [];
  const out = new Map<string, InlineWait>();
  for (const row of Array.isArray(list) ? list : []) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>, id = String(r.id || '');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) continue;
    out.set(id, { id, tagged: r.tagged && typeof r.tagged === 'object' ? r.tagged as TaggerResult : null, line: Math.max(1, Math.floor(Number(r.line)) || 1),
      characterId: String(r.characterId || ''), chatId: String(r.chatId || ''), hostMessageId: String(r.hostMessageId || ''), createdAt: Number(r.createdAt) || 0, ...(typeof r.raw === 'string' && r.raw ? { raw: r.raw.slice(0, 4000) } : {}) });
  }
  return out;
}
async function load(): Promise<Map<string, InlineWait>> {
  if (rows) return rows;
  return loading ||= psGet(INLINE_WAITS_KEY).then(raw => (rows = parse(raw))).finally(() => { loading = undefined; });
}
function save(): Promise<void> {
  const snapshot = [...(rows ?? new Map()).values()];
  const result = tail.catch(() => {}).then(async () => { if (!await psSet(INLINE_WAITS_KEY, snapshot)) throw new Error('대기 칸 저장에 실패했습니다.'); });
  tail = result;
  for (const listener of listeners) listener();
  return result;
}

export async function putInlineWaits(next: InlineWait[]): Promise<void> {
  const map = await load();
  for (const row of next) map.set(row.id, row);
  // The oldest untapped slots go first; their frames fall back to the tagger.
  const extra = map.size - LIMIT;
  if (extra > 0) for (const id of [...map.values()].sort((a, b) => a.createdAt - b.createdAt).slice(0, extra).map(row => row.id)) map.delete(id);
  await save();
}
export async function getInlineWait(id: string): Promise<InlineWait | undefined> { return (await load()).get(id); }
export async function dropInlineWait(id: string): Promise<void> {
  const map = await load();
  if (map.delete(id)) await save();
}
/** Several at once: one save, not one per slot. */
export async function dropInlineWaits(ids: readonly string[]): Promise<void> {
  const map = await load();
  let changed = false;
  for (const id of ids) changed = map.delete(id) || changed;
  if (changed) await save();
}
export async function listInlineWaits(): Promise<InlineWait[]> { return [...(await load()).values()]; }
export async function inlineWaitCount(): Promise<number> { return (await load()).size; }
export function subscribeInlineWaits(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
/** Test seam. */
export function resetInlineWaitStore(): void { rows = undefined; loading = undefined; tail = Promise.resolve(); }
