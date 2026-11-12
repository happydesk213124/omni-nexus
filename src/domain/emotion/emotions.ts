/**
 * Emotion sprites (TTS · 감정 에셋): one standing image per character and base
 * expression, made from the character's looks plus fixed expression tags. No LLM.
 *
 * Replies name a line's mood in the TTS header, `오미선 (happy, whispering): "…"`.
 * Many words share one face, so every word maps onto a small fixed set of base
 * expressions: a character needs about a dozen images, not one per adjective.
 * Words that are delivery, not mood (whispering, slow), map to nothing.
 */
import { splitTagTokens } from '../../core/util/text';

export interface BaseExpression { key: string; label: string; tags: string; words: readonly string[] }

export const DEFAULT_EXPRESSION = 'neutral';
export const BASE_EXPRESSIONS: readonly BaseExpression[] = [
  { key: 'neutral', label: '기본', tags: 'closed mouth, light smile', words: ['neutral', 'calm', 'normal', 'default', 'composed', 'relaxed', 'gentle', 'soft', 'warm', 'kind', '기본', '평온', '차분'] },
  { key: 'happy', label: '기쁨', tags: '2::smile::, open mouth, happy', words: ['happy', 'joy', 'joyful', 'glad', 'cheerful', 'delighted', 'excited', 'bright', 'pleased', 'playful', 'giddy', 'elated', 'thrilled', '기쁨', '행복', '신남', '즐거움'] },
  { key: 'laugh', label: '웃음', tags: '2::laughing::, closed eyes, open mouth', words: ['laugh', 'laughing', 'giggle', 'giggling', 'chuckle', 'chuckling', 'amused', 'cackling', '웃음', '폭소'] },
  { key: 'sad', label: '슬픔', tags: '2::sad::, frown, downcast eyes', words: ['sad', 'sorrowful', 'melancholy', 'gloomy', 'hurt', 'lonely', 'disappointed', 'regretful', 'apologetic', 'depressed', 'heartbroken', 'wistful', '슬픔', '우울', '서운'] },
  { key: 'cry', label: '울음', tags: '2::crying::, tears, streaming tears', words: ['cry', 'crying', 'sobbing', 'sob', 'tearful', 'weeping', 'teary', '울음', '눈물'] },
  { key: 'angry', label: '화남', tags: '2::angry::, frown, clenched teeth', words: ['angry', 'furious', 'mad', 'irritated', 'annoyed', 'enraged', 'rage', 'frustrated', 'hostile', 'sharp', 'cold', 'stern', 'scolding', '화남', '분노', '짜증'] },
  { key: 'surprised', label: '놀람', tags: '2::surprised::, wide-eyed, open mouth', words: ['surprised', 'shocked', 'astonished', 'startled', 'amazed', 'stunned', 'gasping', 'gasp', '놀람', '깜짝'] },
  { key: 'embarrassed', label: '부끄러움', tags: '2::embarrassed::, blush, looking away', words: ['embarrassed', 'shy', 'flustered', 'bashful', 'blushing', 'sheepish', 'awkward', 'nervous', '부끄러움', '수줍음', '당황'] },
  { key: 'scared', label: '두려움', tags: '2::scared::, wide-eyed, sweat', words: ['scared', 'afraid', 'fearful', 'frightened', 'terrified', 'anxious', 'worried', 'panicked', 'trembling', 'uneasy', '두려움', '공포', '걱정', '불안'] },
  { key: 'smug', label: '의기양양', tags: '2::smug::, smirk, half-closed eyes', words: ['smug', 'smirk', 'smirking', 'teasing', 'mischievous', 'confident', 'proud', 'cocky', 'sly', 'flirty', 'flirtatious', '능글', '자신만만', '장난'] },
  { key: 'serious', label: '진지', tags: '2::serious::, closed mouth', words: ['serious', 'determined', 'firm', 'resolute', 'focused', 'grave', 'solemn', 'stoic', 'flat', 'deadpan', '진지', '단호'] },
  { key: 'tired', label: '지침', tags: '2::tired::, half-closed eyes', words: ['tired', 'sleepy', 'exhausted', 'weary', 'drowsy', 'bored', 'lazy', 'sighing', 'sigh', '피곤', '졸림', '지침'] },
  { key: 'confused', label: '갸웃', tags: '2::confused::, head tilt, sweatdrop', words: ['confused', 'puzzled', 'curious', 'doubtful', 'unsure', 'hesitant', 'questioning', 'skeptical', '의아', '갸웃', '궁금'] },
  { key: 'love', label: '설렘', tags: '2::blush::, smile, half-closed eyes, heart', words: ['love', 'loving', 'affectionate', 'tender', 'adoring', 'lovestruck', 'dreamy', 'sweet', '설렘', '애정', '사랑'] },
  { key: 'disgust', label: '불쾌', tags: '2::disgust::, frown, narrowed eyes', words: ['disgust', 'disgusted', 'grossed out', 'contempt', 'disdainful', 'repulsed', '불쾌', '혐오'] },
];
/** Delivery cues: how a line is said, not the face. They choose no image. */
const DELIVERY = new Set(['whisper', 'whispering', 'whispered', 'shout', 'shouting', 'yelling', 'loud', 'quiet', 'quietly', 'slow', 'slowly', 'fast', 'quickly', 'breathy', 'husky', 'low', 'high', 'murmur', 'murmuring', 'mumbling', 'singing', 'monotone', 'tone', 'voice', 'pause', 'pausing']);

const word = (value: unknown): string => String(value ?? '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
const BY_WORD = new Map<string, string>();
for (const row of BASE_EXPRESSIONS) for (const w of [row.key, ...row.words]) BY_WORD.set(word(w), row.key);

export const baseExpression = (key: string): BaseExpression | undefined => BASE_EXPRESSIONS.find(row => row.key === key);

/**
 * The face of one cue word: a base expression key, `null` for a delivery cue or
 * an empty word, and the word itself (lowercased) when no base expression owns it.
 * `extra` maps further words, from the settings table, onto base keys.
 */
export function expressionOfWord(value: unknown, extra: Readonly<Record<string, string>> = {}): string | null {
  const w = word(value).replace(/[^\p{L}\p{N} -]/gu, '').trim();
  if (!w || w.length > 40) return null;
  const custom = extra[w];
  if (custom && baseExpression(custom)) return custom;
  const known = BY_WORD.get(w) ?? BY_WORD.get(w.replace(/(?:ly|ed|ing)$/, ''));
  if (known) return known;
  const parts = w.split(' ');
  if (parts.every(part => DELIVERY.has(part))) return null;
  // A phrase (`soft tone`, `nervously laughing`) takes the face of its first word that has one.
  if (parts.length > 1) for (const part of parts) { const face = BY_WORD.get(part) ?? BY_WORD.get(part.replace(/(?:ly|ed|ing)$/, '')); if (face) return face; }
  return w;
}

/** A TTS tone (`happy, whispering`): its first word with a face, else null (the line keeps the last face). */
export function expressionOfTone(tone: unknown, extra: Readonly<Record<string, string>> = {}): string | null {
  for (const part of String(tone ?? '').split(',')) {
    const face = expressionOfWord(part, extra);
    if (face) return face;
  }
  return null;
}

// ── asset names ────────────────────────────────────────────────────────────

/** Compact form for name comparison: case, width and separators do not matter. */
export const compactName = (value: unknown): string => word(value).replace(/[\s_.·•･\-]+/g, '');
const SEPARATORS = /[\s_.·•･\-]+/;
const EXTENSION = /\.(?:png|webp|jpe?g|gif|avif)$/i;

/**
 * Whether an asset is this person's image for this face: its name, split at `_`,
 * spaces, `.` or `-`, holds a word for the face (any synonym) and, in the rest in
 * either order, one of the person's names. `오미선_happy`, `happy_misun`,
 * `Ohmisun Happy.webp` and `Sasaki Yua enraged` all match their person.
 */
export function assetMatchesExpression(assetName: unknown, names: readonly string[], face: string): boolean {
  // A picture Omni drew (`omni_<person>_<face>`) is that person's too.
  const parts = String(assetName ?? '').replace(EXTENSION, '').replace(/^omni_/i, '').split(SEPARATORS).map(word).filter(Boolean);
  if (parts.length < 2) return false;
  const wanted = new Set(names.map(compactName).filter(name => name.length >= 2));
  if (!wanted.size) return false;
  // A face may be two words (`grossed out`); the person is everything else, in either order.
  for (let i = 0; i < parts.length; i++) for (const span of [1, 2]) {
    if (i + span > parts.length || expressionOfWord(parts.slice(i, i + span).join(' ')) !== face) continue;
    const rest = [...parts.slice(0, i), ...parts.slice(i + span)];
    if (rest.length && (wanted.has(compactName(rest.join(''))) || wanted.has(compactName([...rest].reverse().join(''))))) return true;
  }
  return false;
}

/**
 * 감정 에셋 › 이 태그가 들어가면 빼기, the first value it holds. A standing portrait is shown on every line, and a
 * roster's looks may carry tags meant for scenes; what counts is the user's to change.
 */
export const EMOTION_EXCLUDE_DEFAULT = ['penis', 'cock', 'dick', 'testicle', 'testicles', 'scrotum', 'erection'].map(word => '*' + word).join(', ');

const tagWords = (value: string): string => value.toLowerCase().replace(/_/g, ' ').trim();

/**
 * Takes out of a tag list what the rules name, commas between them: `penis` is that tag and no other, `*penis`
 * every tag with that word in it (huge penis, not penises). Emphasis does not hide a tag, and the rest of its group stays.
 */
export function excludeTags(tags: unknown, rules: unknown): string {
  const list = String(rules ?? '').split(',').map(tagWords).filter(rule => rule.replace(/^\*/, '').trim());
  const exact = new Set(list.filter(rule => !rule.startsWith('*')));
  const words = list.filter(rule => rule.startsWith('*')).map(rule => rule.slice(1).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Letters of any language around the word make it another word; \b knows only ASCII.
  const word = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null;
  const sweep = (text: string): string => splitTagTokens(text).flatMap(tag => {
    const group = /^(-?\d+(?:\.\d+)?::)([\s\S]*)(::)$/.exec(tag) || /^([{[(]+)([\s\S]*?)([}\])]+)$/.exec(tag);
    if (group) {
      const kept = sweep(group[2]!);
      return kept ? [group[1] + kept + group[3]] : [];
    }
    return exact.has(tagWords(tag)) || word?.test(tagWords(tag)) ? [] : [tag];
  }).join(', ');
  return list.length ? sweep(String(tags ?? '')) : String(tags ?? '');
}

/**
 * 기본 nude: the costume number a nude face is kept under, past any costume's (1–99). A cue names it `이름_nude`.
 * Only someone 감정 에셋 may draw nude is ever dressed in it (nudeForbidden in character/tags.ts).
 */
export const NUDE_COSTUME = 100;

/** The emotion asset name Omni writes: `이름_감정.png` (PNG keeps a transparent background). */
export function emotionAssetName(person: string, face: string, ext = 'png', costume = 0): string {
  const name = String(person ?? '').normalize('NFKC').trim().replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
  // `omni_` first: never mixed up with the bot's own assets. A costume's (`c2_`) is not the default one's either:
  // its mark stands before the name, for beside the face a phrase (`c2 happy`) reads as that face, the name left bare.
  const worn = costume === NUDE_COSTUME ? 'nude_' : costume > 0 ? `c${costume}_` : '';
  return `omni_${worn}${name}_${face}.${ext.replace(/[^a-z0-9]/gi, '') || 'png'}`;
}

// ── prompt ─────────────────────────────────────────────────────────────────

export interface EmotionPromptInput {
  looks: string;
  face: string;
  faceTags?: string;
  pose?: string;
  prefix?: string;
  suffix?: string;
  transparent?: boolean;
}
export const DEFAULT_POSE = '2::cowboy shot::, standing, looking at viewer, solo';

const joinTags = (...parts: unknown[]): string => parts.map(part => String(part ?? '').trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ');

/** One sprite's prompt: settings prefix, looks, the face, the pose, the background, settings suffix. */
export function emotionPrompt(input: EmotionPromptInput): string {
  const tags = input.faceTags?.trim() || baseExpression(input.face)?.tags || `2::${input.face}::`;
  const background = input.transparent ? 'transparent background' : 'white background, simple background';
  return joinTags(input.prefix, input.looks, tags, input.pose?.trim() || DEFAULT_POSE, background, input.suffix);
}
