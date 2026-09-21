/** Retired stock new-character sections are replaced without changing stored edits. */
export function scenePromptWithoutLegacyLooks(text: string): string {
  return text.replace(/## New characters \(unknown OR incomplete\)[\s\S]*?(?=## Shots)/,
    '## New characters\nUse the shared character appearance rules.\n\n');
}
