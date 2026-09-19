/**
 * First-tagger CharInfo / User Info strings. Pure so we can assert that
 * `personality` on the job body is never used as {{user}}.
 */
import { cleanText } from '../../core/util/text.ts';

export function pickSelectedPersona(
  db: unknown,
): { personaPrompt?: unknown; note?: unknown } | null {
  if (!db || typeof db !== 'object') return null;
  const rec = db as Record<string, unknown>;
  if (!Array.isArray(rec.personas)) return null;
  const idx = typeof rec.selectedPersona === 'number' ? rec.selectedPersona : 0;
  const row = rec.personas[idx];
  if (!row || typeof row !== 'object') return null;
  return row as { personaPrompt?: unknown; note?: unknown };
}

export function pickPersonaUserText(
  persona: { personaPrompt?: unknown; note?: unknown } | null | undefined,
): string {
  return cleanText(persona?.personaPrompt, 8000) || cleanText(persona?.note, 8000);
}

export function pickCharInfoText(
  requestDesc: unknown,
  hostChar: { description?: unknown; desc?: unknown } | null | undefined,
): string {
  const fromRequest = cleanText(requestDesc, 12000);
  if (fromRequest) return fromRequest;
  return cleanText(hostChar?.description, 12000) || cleanText(hostChar?.desc, 12000);
}

export function mergeTaggerCharUserFields(input: {
  charInfoOn: boolean;
  userInfoOn: boolean;
  requestChar: unknown;
  requestPersona: unknown;
  hostChar: { description?: unknown; desc?: unknown } | null | undefined;
  hostPersona: { personaPrompt?: unknown; note?: unknown } | null | undefined;
}): { character_description: string; persona_description: string } {
  void input.requestPersona;
  return {
    character_description: input.charInfoOn
      ? pickCharInfoText(input.requestChar, input.hostChar)
      : '',
    persona_description: input.userInfoOn ? pickPersonaUserText(input.hostPersona) : '',
  };
}
