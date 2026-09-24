import { stripCbs } from '../../core/util/text';

/** Resolve saved legacy templates before stripping host-only CBS expressions. */
export function preprocessPrompt(template: string, minValue: unknown, maxValue: unknown): string {
  const positiveInt = (value: unknown, fallback: number): number => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 ? Math.floor(number) : fallback;
  };
  const min = positiveInt(minValue, 1);
  const max = Math.max(min, positiveInt(maxValue, 3));
  const resolved = stripCbs(template
    .replace(/\{\{(?:getglobalvar::toggle_Card\.Image\.Min|image_min)\}\}/g, String(min))
    .replace(/\{\{(?:getglobalvar::toggle_Card\.Image\.Max|image_max)\}\}/g, String(max)));
  if (!resolved) return '';
  // This also repairs old saved prompts that still ask for P# paragraph labels.
  return `${resolved}\n\nCurrent request: select ${min}-${max} distinct visual moments from the current L-numbered message. If fewer moments are supported, return fewer; never invent events to fill the count. Copy the exact L labels from the input (L1, L2, ...); these override any P# notation above. Earlier unnumbered messages are context only. Skip CSS, HTML markup and status panels. This is reference analysis: keep facts from the source and omit uncertain details.`;
}
