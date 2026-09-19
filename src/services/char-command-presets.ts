import { CHAR_COMMAND_PRESETS_KEY } from '../core/constants';
import type { ApiResult, CommandPreset } from '../core/types';
import { cleanText } from '../core/util/text';
import { psGet, psSet } from '../storage/device-store';
import { getConfig } from './context';
import { saveConfig } from './settings';

function asList(raw: unknown): CommandPreset[] {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { items?: unknown } : null;
  const arr = Array.isArray(raw) ? raw : Array.isArray(rec?.items) ? rec!.items : [];
  const out: CommandPreset[] = [];
  for (const row of arr) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = cleanText(r.id, 80);
    const name = cleanText(r.name, 80);
    const cmd = cleanText(r.cmd ?? r.text ?? r.body ?? r.instruction, 4000);
    const cmd_post = cleanText(r.cmd_post ?? r.cmdPost ?? r.suffix, 2000);
    if (!id && !name && !cmd) continue;
    out.push({
      id: id || `cmd_${out.length}`,
      name: name || `명령 ${out.length + 1}`,
      cmd,
      ...(cmd_post ? { cmd_post } : {}),
    });
  }
  return out;
}

function byId(items: CommandPreset[]): Map<string, CommandPreset> {
  const map = new Map<string, CommandPreset>();
  for (const row of items) {
    if (row.id) map.set(row.id, row);
  }
  return map;
}

async function mergeLegacyOnce(cardItems: CommandPreset[]): Promise<CommandPreset[]> {
  const legacy = asList(await psGet(CHAR_COMMAND_PRESETS_KEY));
  if (!legacy.length) return cardItems;
  const map = byId(cardItems);
  for (const row of legacy) {
    if (!map.has(row.id)) map.set(row.id, row);
  }
  const merged = [...map.values()];
  await psSet(CHAR_COMMAND_PRESETS_KEY, { items: merged });
  return merged;
}

export async function listCommandPresets(): Promise<ApiResult> {
  const card = getConfig().card;
  const fromCard = asList(card?.command_presets);
  const items = await mergeLegacyOnce(fromCard);
  if (items !== fromCard && card) {
    card.command_presets = items;
    await saveConfig();
  }
  return { ok: true, items };
}

export async function saveCommandPresets(items: unknown): Promise<ApiResult> {
  const next = asList(items);
  const card = getConfig().card;
  if (card) card.command_presets = next;
  await saveConfig();
  await psSet(CHAR_COMMAND_PRESETS_KEY, { items: next });
  return { ok: true, items: next };
}
