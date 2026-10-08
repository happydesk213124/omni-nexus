export function imageHistoryRoot(id: string): string {
  return id.replace(/_(?:r|s)\d+$/, '');
}

export function nextImageRevision(id: string, kind: 'r' | 's', ids: readonly string[]): string {
  const root = imageHistoryRoot(id);
  let count = 0;
  for (const candidate of ids) {
    if (imageHistoryRoot(candidate) !== root) continue;
    const match = candidate.match(new RegExp('_' + kind + '(\\d+)$'));
    if (match) count = Math.max(count, Number(match[1]));
  }
  return `${root}_${kind}${count + 1}`;
}
