import { cleanText } from '../core/util/text.ts';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function studioQuotaFillPct(res: Record<string, unknown>): number {
  const keys = Array.isArray(res.keys) ? res.keys : [];
  for (const raw of keys) {
    const k = asRecord(raw);
    if (k.ok === false) continue;
    const usage = asRecord(k.v5_usage);
    const pct = Number(usage.pct);
    if (Number.isFinite(pct)) return Math.max(0, pct);
  }
  return -1;
}

export function formatStudioQuotaLine(key: Record<string, unknown>): string {
  const fam = cleanText(key.family, 40).toUpperCase() || 'NAI';
  const suffix = cleanText(key.suffix, 20);
  const head = suffix ? `${fam} …${suffix}` : fam;
  if (key.ok === false) return `${head} 실패`;
  const anlas = Number.isFinite(Number(key.total)) ? Number(key.total) : 0;
  const usage = asRecord(key.v5_usage);
  const pct = Number(usage.pct);
  const v5 = Number.isFinite(pct)
    ? ` · V5 ${cleanText(usage.label, 40) || `${Math.round(pct)}%`}`
    : '';
  return `${head}  ${anlas} Anlas${v5}`;
}

export function formatStudioQuota(res: Record<string, unknown>): string {
  const keys = Array.isArray(res.keys) ? res.keys : [];
  if (!keys.length) return '등록된 NovelAI 키가 없습니다.';
  return keys.map((raw) => formatStudioQuotaLine(asRecord(raw))).join('\n');
}
