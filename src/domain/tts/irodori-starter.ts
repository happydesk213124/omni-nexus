import type { TtsVoice } from '../../core/tts-types';

/**
 * Irodori's starter voices: a server begins with no voice at all, and auto-assignment has nothing to choose among
 * until there are presets of each gender. Each row is designed from its description, kept on the server under `id`
 * and listed as a preset with the gender and tags the assignment engines choose by.
 *
 * Twenty, not the full grid: gender x age x personality is 48 and up, minutes of GPU for voices mostly never used.
 * Most speakers are 청년 (a high-schooler too, as the first-cue emoji have it), so the personalities are spread
 * there, and a child, a middle-aged and an elderly voice stand one each. Tags are words of the voice vocabulary
 * (voice-words.ts), so they reach the engines in English like any other voice's.
 */
export interface IrodoriStarter { id: string; name: string; gender: TtsVoice['gender']; tags: readonly string[]; caption: string }
const row = (id: string, name: string, gender: TtsVoice['gender'], tags: string, caption: string): IrodoriStarter =>
  ({ id: `omni-${id}`, name, gender, tags: tags.split(',').map(tag => tag.trim()), caption });
export const IRODORI_STARTERS: readonly IrodoriStarter[] = [
  row('f-child-bright', '여자아이 · 밝은', 'female', '어린이, 밝은, 귀여운, 높음', '小学生くらいの幼い女の子の声。高くて明るく、元気いっぱいに話す。'),
  row('f-young-bright', '여성 · 밝은', 'female', '청년, 밝은, 명랑한, 활기찬', '明るく元気な若い女性の声。はきはきと楽しそうに話す。'),
  row('f-young-calm', '여성 · 차분한', 'female', '청년, 차분함, 지적인, 또박또박', '落ち着いた若い女性の声。知的で、丁寧にはっきりと話す。'),
  row('f-young-haughty', '여성 · 앙칼진', 'female', '청년, 도도한, 당당한, 자신감 있는', '気が強く高飛車な若い女性の声。きつめの口調で、鋭く言い放つ。'),
  row('f-young-tsundere', '여성 · 츤데레', 'female', '청년, 츤데레, 툴툴대는, 높음', '素直になれないツンデレな若い女性の声。つんつんした口調で、少し照れながら話す。'),
  row('f-young-shy', '여성 · 수줍은', 'female', '청년, 수줍은, 소심한, 부드러운', '内気で恥ずかしがり屋な若い女性の声。小さめの声で、おずおずと話す。'),
  row('f-young-gentle', '여성 · 다정한', 'female', '청년, 다정한, 따뜻한, 상냥한', '優しくて穏やかな若い女性の声。柔らかく、包み込むように話す。'),
  row('f-young-cool', '여성 · 쿨한', 'female', '청년, 쿨함, 무덤덤한, 냉철한, 낮음', 'クールで感情を抑えた若い女性の声。低めの声で、淡々と話す。'),
  row('f-adult-mature', '여성 · 성숙한', 'female', '성인, 성숙한, 요염한, 여유로운, 낮음', '大人っぽく色気のある女性の声。低めの声で、余裕たっぷりにゆっくり話す。'),
  row('f-middle-warm', '중년 여성 · 다정한', 'female', '중년, 따뜻한, 다정한, 차분함', '中年の女性の声。落ち着いていて温かく、母親のように優しく話す。'),
  row('f-elder', '할머니', 'female', '노인, 따뜻한, 느림', '年配のおばあさんの声。少ししわがれた声で、ゆっくり穏やかに話す。'),
  row('m-child-bright', '남자아이 · 밝은', 'male', '어린이, 밝은, 활기찬, 소년 같은', '小学生くらいの幼い男の子の声。高くて元気で、わんぱくに話す。'),
  row('m-young-bright', '남성 · 밝은', 'male', '청년, 밝은, 활기찬, 친근한', '明るく爽やかな若い男性の声。元気よく、親しみやすく話す。'),
  row('m-young-calm', '남성 · 차분한', 'male', '청년, 차분함, 지적인, 부드러운', '落ち着いた若い男性の声。知的で穏やかに、丁寧に話す。'),
  row('m-young-rough', '남성 · 까칠한', 'male', '청년, 거친 목소리, 툴툴대는, 무뚝뚝한', 'ぶっきらぼうで荒っぽい若い男性の声。乱暴な口調で、不機嫌そうに話す。'),
  row('m-young-cool', '남성 · 쿨한', 'male', '청년, 쿨함, 과묵한, 낮음', 'クールで無口な若い男性の声。低い声で、淡々と短く話す。'),
  row('m-young-gentle', '남성 · 다정한', 'male', '청년, 다정한, 따뜻한, 상냥한', '優しくて柔らかい若い男性の声。穏やかに、いたわるように話す。'),
  row('m-young-sly', '남성 · 능글맞은', 'male', '청년, 능글맞은, 여유로운, 장난기 있는', '余裕のある飄々とした若い男性の声。からかうように、軽い調子で話す。'),
  row('m-middle-deep', '중년 남성 · 중후한', 'male', '중년, 깊은, 위엄 있는, 낮음', '中年の男性の声。低く渋い声で、威厳をもって落ち着いて話す。'),
  row('m-elder', '할아버지', 'male', '노인, 차분함, 느림', '年配のおじいさんの声。しわがれた低い声で、ゆっくり話す。'),
];
/** The starters no preset stands for yet, by the server voice each is kept as. */
export function missingIrodoriStarters(presets: readonly Pick<TtsVoice, 'fishId'>[]): IrodoriStarter[] {
  const held = new Set(presets.map(voice => voice.fishId));
  return IRODORI_STARTERS.filter(starter => !held.has(starter.id));
}
