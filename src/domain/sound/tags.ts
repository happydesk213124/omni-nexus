/**
 * BGM tag vocabulary. The chat model writes three tags from this list on the
 * line before the part of a reply where the music changes, `[[bgm:tense,chase,fast]]`; items carry tags from the
 * same list, so plain word matching settles almost every reply for free.
 */
export const BGM_TAGS: readonly string[] = Object.freeze([
  // mood
  'calm', 'happy', 'sad', 'tense', 'scary', 'romantic', 'mysterious', 'epic', 'comedic', 'melancholic', 'hopeful', 'dark', 'cute',
  // place / situation
  'daily', 'school', 'city', 'night', 'nature', 'rain', 'cafe', 'home', 'battle', 'chase', 'dungeon', 'festival', 'fantasy', 'scifi',
  // tempo
  'slow', 'mid', 'fast',
]);

/** Words the model (or a person) writes instead of the vocabulary key. */
const SYNONYMS: Record<string, string> = {
  평온: 'calm', 잔잔: 'calm', 차분: 'calm', 평화: 'calm', peaceful: 'calm', relaxed: 'calm',
  밝은: 'happy', 즐거운: 'happy', 신나는: 'happy', 행복: 'happy', cheerful: 'happy', upbeat: 'happy', joyful: 'happy',
  슬픈: 'sad', 슬픔: 'sad', sorrow: 'sad', 애절: 'melancholic', 쓸쓸: 'melancholic', 우울: 'melancholic', lonely: 'melancholic',
  긴장: 'tense', 긴박: 'tense', 서스펜스: 'tense', suspense: 'tense', urgent: 'tense',
  무서운: 'scary', 공포: 'scary', horror: 'scary', creepy: 'scary', 섬뜩: 'scary',
  로맨틱: 'romantic', 설렘: 'romantic', 사랑: 'romantic', love: 'romantic',
  신비: 'mysterious', 미스터리: 'mysterious', mystery: 'mysterious',
  웅장: 'epic', 장엄: 'epic', heroic: 'epic', grand: 'epic',
  코믹: 'comedic', 유쾌: 'comedic', 웃긴: 'comedic', funny: 'comedic', comedy: 'comedic',
  희망: 'hopeful', 감동: 'hopeful', 어두운: 'dark', 음산: 'dark', gloomy: 'dark', 귀여운: 'cute', 아기자기: 'cute',
  일상: 'daily', everyday: 'daily', 학교: 'school', 교실: 'school', classroom: 'school', 도시: 'city', 거리: 'city', urban: 'city',
  밤: 'night', 새벽: 'night', 자연: 'nature', 숲: 'nature', forest: 'nature', 비: 'rain', rainy: 'rain', 카페: 'cafe', coffee: 'cafe',
  집: 'home', 방: 'home', 전투: 'battle', 싸움: 'battle', fight: 'battle', combat: 'battle', 추격: 'chase', 도주: 'chase', pursuit: 'chase',
  던전: 'dungeon', 동굴: 'dungeon', cave: 'dungeon', 축제: 'festival', party: 'festival', 판타지: 'fantasy', 마법: 'fantasy', magic: 'fantasy',
  sf: 'scifi', 'sci-fi': 'scifi', 미래: 'scifi', 사이버: 'scifi', cyber: 'scifi', futuristic: 'scifi',
  느린: 'slow', 느림: 'slow', 보통: 'mid', medium: 'mid', moderate: 'mid', 빠른: 'fast', 빠름: 'fast', quick: 'fast', 질주: 'fast',
};

/** Case-, width- and spacing-insensitive form; synonyms fold into their vocabulary key. */
export function normalizeSoundTag(tag: string): string {
  const key = String(tag || '').normalize('NFKC').toLowerCase().replace(/[\s_.·•･]+/g, '');
  return SYNONYMS[key] ?? key;
}
export function soundTags(raw: string | readonly string[]): string[] {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(/[,，、\n]/);
  return [...new Set(list.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 30);
}

const BGM_MARKER = /\[\[bgm:([^\]\n]{1,200})\]\]/i;
/** The tags of a reply's BGM marker, or null when the reply has none. */
export function parseBgmMarker(text: string): string[] | null {
  const hit = BGM_MARKER.exec(String(text || ''));
  return hit ? soundTags(hit[1]!).slice(0, 5) : null;
}
/** Every BGM marker in a line, in order: a reply may change the music where the scene turns. */
export function bgmMarkers(text: string): { tags: string[]; index: number; length: number }[] {
  return [...String(text || '').matchAll(new RegExp(BGM_MARKER.source, 'gi'))].map(hit => ({ tags: soundTags(hit[1]!).slice(0, 5), index: hit.index ?? 0, length: hit[0].length }));
}

/** Chat-model instruction; it names the vocabulary but never the track list. */
export function bgmPromptText(tags: readonly string[]): string {
  return [
    'Background music cue: write one line [[bgm:mood,place,tempo]] — exactly three tags, chosen only from this list — only where the music should change: when no cue has been written in this chat yet, or when the mood or place turns sharply (a sudden attack, a jump to another place or time).',
    `Tags: ${tags.join(', ')}`,
    'Put the cue on its own line directly before the first narration or dialogue line of the part it scores — after any title, status panel or header, never at the very top of the reply by habit.',
    'While the scene goes on in the same mood write no cue; the current music keeps playing. At most three cues per reply. Never mention the cues in the story.',
  ].join('\n');
}
