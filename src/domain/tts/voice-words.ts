import presets from '../../config/tts-presets.json';

/**
 * Voice and character tags are written and shown in Korean (청년, 허스키, 장난기 있는), but the models that pick
 * a voice read English far better, the embedding above all: 「청년」 and 「young adult」 are one idea to a person
 * and two strangers to text-embedding-3-small next to an English story summary. So the words go out in English
 * and come back in Korean, by this fixed table: no translation request, nothing stored differently.
 *
 * Every word the sample voices, the 첫 대사 이모지 table and the voice picker's vocabulary use is here. A word that
 * is not (the reader's own) goes as written: the models read Korean too, only less sharply.
 */
const WORDS: ReadonlyArray<readonly [string, string]> = [
  // gender
  ['여성', 'female'], ['남성', 'male'],
  // age: six steps (the sample voices once had three, and 148 of 176 were 청년)
  ['어린이', 'child'], ['10대', 'teen'], ['청년', 'young adult'], ['성인', 'adult'], ['중년', 'middle-aged'], ['노인', 'elderly'],
  // pitch
  ['높음', 'high-pitched'], ['중간', 'mid-pitched'], ['낮음', 'low-pitched'], ['깊은', 'deep'],
  // timbre
  ['맑은', 'clear'], ['허스키', 'husky'], ['숨소리 섞인', 'breathy'], ['콧소리', 'nasal'], ['굵은', 'thick'], ['가녀린', 'thin and delicate'],
  ['달콤한', 'sweet'], ['앳된', 'youthful'], ['거친 목소리', 'rough'], ['소프트', 'soft'], ['부드러운', 'gentle'],
  // pace and delivery
  ['느림', 'slow'], ['느릿느릿', 'drawling'], ['빠른 말투', 'fast-talking'], ['또박또박', 'crisp'], ['단조로운', 'monotone'],
  ['드라마틱', 'dramatic'], ['감정 표현이 풍부한', 'expressive'], ['존댓말', 'polite speech'], ['아나운서', 'announcer'],
  ['내레이션', 'narration'], ['스토리텔링', 'storytelling'], ['시네마틱', 'cinematic'], ['예스러운', 'old-fashioned speech'],
  // mood and character
  ['차분함', 'calm'], ['따뜻한', 'warm'], ['신비로운', 'mysterious'], ['밝은', 'bright'], ['명랑한', 'cheerful'], ['친근한', 'friendly'],
  ['장난기 있는', 'playful'], ['지적인', 'intelligent'], ['편안한', 'relaxed'], ['어두운', 'dark'], ['자신감 있는', 'confident'],
  ['활기찬', 'energetic'], ['열정적인', 'passionate'], ['공감하는', 'empathetic'], ['섹시한', 'sexy'], ['광기', 'unhinged'],
  ['권위 있는', 'authoritative'], ['진지한', 'serious'], ['귀여운', 'cute'], ['엉뚱한', 'quirky'], ['도도한', 'haughty'],
  ['성숙한', 'mature'], ['여유로운', 'easygoing'], ['고풍스러운', 'classical'], ['우아한', 'elegant'], ['무덤덤한', 'deadpan'],
  ['츤데레', 'tsundere'], ['찡찡대는', 'whiny'], ['아이돌', 'idol'], ['떼쓰는', 'bratty'], ['순진한', 'innocent'],
  ['전문가', 'professional'], ['텐션 높은', 'hyper'], ['오만한', 'arrogant'], ['미소 지음', 'smiling'], ['귀찮은', 'bored'],
  ['나른한', 'languid'], ['쿨함', 'cool'], ['얀데레', 'yandere'], ['냉철한', 'cold'], ['음란은 안 돼', 'prudish'],
  ['툴툴대는', 'grumpy'], ['친밀한', 'intimate'], ['약한 듯 강한', 'quietly strong'], ['생글생글', 'always smiling'],
  ['사이코패스', 'psychopathic'], ['소심한', 'timid'], ['슬픈', 'sad'], ['수줍은', 'shy'], ['다정한', 'affectionate'],
  ['상냥한', 'kind'], ['무뚝뚝한', 'blunt'], ['능글맞은', 'sly'], ['당당한', 'bold'], ['애교', 'charming'], ['요염한', 'seductive'],
  ['위엄 있는', 'dignified'], ['차가운', 'icy'], ['피곤한', 'tired'], ['겁먹은', 'scared'], ['화난', 'angry'], ['울먹이는', 'tearful'],
  ['수다스러운', 'chatty'], ['과묵한', 'taciturn'], ['순수한', 'pure'], ['악당', 'villainous'], ['영웅적인', 'heroic'],
  ['기계적인', 'robotic'], ['사투리', 'dialect'], ['중성적인', 'androgynous'], ['소년 같은', 'boyish'], ['우울한', 'gloomy'],
  ['신난', 'excited'], ['몽환적인', 'dreamy'], ['허당', 'clumsy'], ['리더', 'leader'], ['집사', 'butler'], ['메이드', 'maid'],
];
const TO_ENGLISH = new Map(WORDS.map(([ko, en]) => [ko, en]));
const TO_KOREAN = new Map(WORDS.map(([ko, en]) => [en, ko]));
const key = (word: string) => String(word || '').normalize('NFKC').trim();

/** The English of a voice or character tag; one the table does not know, as written. */
export function englishVoiceWord(word: string): string { return TO_ENGLISH.get(key(word)) ?? key(word); }
/** Tags in English, each once, the empty dropped. */
export function englishVoiceTags(tags: readonly string[]): string[] { return [...new Set(tags.map(englishVoiceWord).filter(Boolean))]; }
/** A model's English answer back in the words the reader sees; an English word the table lacks stays English. */
export function koreanVoiceWord(word: string): string { const clean = key(word); return TO_KOREAN.get(clean.toLowerCase()) ?? clean; }
/** The English vocabulary a model is asked to answer in (gender is asked apart). */
export const VOICE_VOCABULARY: readonly string[] = Object.freeze(WORDS.filter(([ko]) => ko !== '여성' && ko !== '남성').map(([, en]) => en));

/**
 * The sample voice a Fish model is, by its id: its English name (「Shinobu Kocho (Demon Slayer)」, which a model
 * knows the voice of, where 「시노부 (귀멸의 칼날)」 is a guess), its tags as first shipped and as now shipped.
 */
interface Preset { name: string; tag: string; id: string; en?: string; fine?: string }
const PRESETS = new Map((presets as Preset[]).map(row => [row.id.toLowerCase(), row]));
export function presetVoiceEnglishName(fishId: string): string { return PRESETS.get(String(fishId || '').toLowerCase())?.en || ''; }
/** A voice's name as a model is told it: the sample's English name, or the name the reader gave it. */
export function voiceNameForModel(voice: { name: string; fishId: string }): string { return presetVoiceEnglishName(voice.fishId) || voice.name; }

const tagList = (text: string) => text.split(',').map(t => t.trim()).filter(Boolean);
/**
 * A sample voice still holding the tags it first shipped with gets the finer ones (age in six steps, pitch, timbre).
 * One whose tags the reader changed keeps theirs. Returns the tags to keep (the same array when nothing moves).
 */
export function upgradedPresetTags(voice: { fishId: string; tags: string[] }): string[] {
  const preset = PRESETS.get(String(voice.fishId || '').toLowerCase());
  if (!preset?.fine) return voice.tags;
  const first = tagList(preset.tag), now = voice.tags.map(t => t.trim());
  const same = first.length === now.length && first.every(t => now.includes(t));
  return same ? tagList(preset.fine) : voice.tags;
}
/** The sample voices as an import list, with the finer tags. */
export function presetVoiceRows(): Array<{ name: string; tag: string; id: string }> {
  return (presets as Preset[]).map(row => ({ name: row.name, tag: row.fine || row.tag, id: row.id }));
}
