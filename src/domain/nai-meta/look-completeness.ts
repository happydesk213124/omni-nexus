/** Conservative coverage check: unfamiliar tags request visual help, not invented defaults. */
export function metadataHasHairAndEyes(tags: readonly string[]): boolean {
  const text = tags.join(', ').toLowerCase().replace(/_/g, ' ');
  const hair = /\b(?:(?:short|medium|long|very long|curly|wavy|straight|messy|spiky) hair|bangs|braids?|ponytail|twintails|hair bun|bob cut|bald)\b/.test(text);
  const color = /\b(?:red|orange|yellow|green|blue|purple|pink|brown|black|white|gr[ae]y|silver|golden?|violet|aqua|hazel|amber) eyes\b|\bheterochromia\b/.test(text);
  const shape = /\b(?:tsurime|tareme|sanpaku|slit pupils|no pupils|(?:round|almond|narrow|wide|large|small) eyes|no eyes|eyeless)\b/.test(text);
  return hair && shape && (color || /\b(?:no eyes|eyeless)\b/.test(text));
}
