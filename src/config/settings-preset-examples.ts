import allComic from './settings-preset-all-comic.json';
import { DEFAULT_CONFIG } from './defaults';
import { normalizeSettingsPreset, type SettingsPreset } from '../domain/settings-preset';

type Example = [string, string, string, Record<string, unknown>, string, string?];
const EXAMPLES: Example[] = [
  ['balanced', '균형 잡힌 삽화', '주요 장면을 2~3장의 삽화로 정리합니다.', { image_min: 2, image_max: 3 }, '중요한 행동과 감정 변화를 골라 삽화로 구성하세요. 같은 장면을 반복하지 말고 원문 흐름에 맞춰 배치하세요.'],
  ['one-shot', '핵심 한 장', '가장 중요한 장면 한 장에 집중합니다.', { image_min: 1, image_max: 1 }, '이 메시지를 대표하는 핵심 장면 하나만 선택하세요. 동시에 일어나지 않은 사건을 한 그림에 합치지 마세요.'],
  ['pov', 'POV · 1인칭 시점', '시점 인물의 눈으로 상대와 공간을 바라보는 구도입니다.', { image_min: 2, image_max: 3, natural_base: 'supplement' }, '카메라는 원문의 시점 인물의 눈 위치에 두고 pov 구도로 작성하세요. 상대 인물과 공간을 시점 인물이 바라보는 방향에서 묘사하세요. 시점 인물의 얼굴이나 전신을 화면 안에 넣지 마세요. 손이나 팔은 원문의 행동상 실제로 시야에 들어오는 경우에만 포함하세요. 상대가 시점 인물을 바라보는 장면에서만 looking at viewer를 사용하고 원문에 없는 시선이나 행동을 만들지 마세요.'],
  ['cinematic', '영화 같은 연출', '거리와 시점을 바꿔 장면의 리듬을 살립니다.', { image_min: 2, image_max: 3, auto_aspect: true, natural_base: 'supplement' }, '도입은 넓은 구도, 중요한 행동은 중간 거리, 감정 변화는 가까운 구도로 구성하세요. 조명과 시선 방향을 구체적으로 적고 인접한 샷의 카메라를 단조롭게 반복하지 마세요.'],
  ['emotion', '표정과 대화', '표정·시선·반응을 중심으로 구성합니다.', { image_min: 2, image_max: 3, character_max: 2 }, '말하는 인물과 듣는 인물의 표정, 시선, 손짓을 중심으로 장면을 고르세요. 원문에 없는 대사나 감정은 만들지 마세요.'],
  ['action', '액션 흐름', '행동의 시작과 반응을 연속적으로 보여줍니다.', { image_min: 3, image_max: 4, auto_aspect: true }, '핵심 행동의 준비, 실행, 반응이 이어지도록 장면을 선택하세요. 인물의 위치와 이동 방향, 사용 중인 소품을 유지하고 서로 다른 순간을 섞지 마세요.'],
  ['scenery', '풍경과 공간', '장소·시간대·빛의 변화를 중심으로 고릅니다.', { image_min: 1, image_max: 2, no_humans_when_no_char: true }, '원문에 나온 풍경과 공간을 우선 선택하세요. 장소의 구조, 시간대, 날씨, 빛을 구체적으로 적고 원문에 없는 인물은 추가하지 마세요.'],
  ['costume', '복장과 소품', '의상과 소품의 연속성을 살리는 삽화입니다.', { image_min: 2, image_max: 3, costume: true }, '옷과 소품이 잘 보이는 구도를 선택하세요. 등장인물의 현재 복장을 유지하고 원문에서 바뀐 부분만 갱신하세요. 색상과 형태를 명확하게 구분하세요.'],
  ['comic-dialogue', '대화 중심 만화', '대화와 반응을 2~3컷의 만화로 구성합니다.', { image_min: 1, image_max: 2, comic_gen: 'on', comic_gen_ratio: 100, comic_llm_batch: 'with_main', nai5_only: true, nai5_speech: true }, '모든 이미지를 kind: comic으로 요청하세요. 대화의 전환과 인물의 반응을 중심으로 원문 순서를 유지하세요.', '한 페이지에 2~3컷을 구성하세요. 말하는 인물과 듣는 인물의 반응을 구분하고, 대사는 원문에 있는 직접 발화만 사용하세요. 한 컷의 상호작용에 필요한 인물을 빠뜨리지 마세요.'],
  ['comic-silent', '무대사 만화', '표정과 행동만으로 전개되는 만화입니다.', { image_min: 1, image_max: 2, comic_gen: 'on', comic_gen_ratio: 100, comic_llm_batch: 'with_main', nai5_only: true, nai5_speech: false }, '모든 이미지를 kind: comic으로 요청하세요. 표정과 행동이 이어지는 장면을 선택하세요.', '대사·독백·설명 문구를 넣지 말고 text는 비워 두세요. 표정, 시선, 손짓으로 흐름이 드러나는 2~4컷을 구성하세요. 원문에 없는 사건을 만들지 마세요.'],
  ['mixed', '삽화와 만화 혼합', '대표 장면은 삽화, 연속 행동은 만화로 구성합니다.', { image_min: 2, image_max: 3, comic_gen: 'on', comic_gen_ratio: 50, comic_llm_batch: 'with_main' }, '독립적으로 인상적인 장면은 삽화로, 시간에 따른 행동이나 반응이 중요한 장면은 만화로 선택하세요. 같은 내용을 두 형식으로 반복하지 마세요.', '선택된 장면의 시간 순서가 분명한 2~3컷으로 구성하세요. 인물·복장·장소의 연속성을 유지하세요.'],
];

export function settingsPresetExamples(): SettingsPreset[] {
  const supplied = normalizeSettingsPreset(allComic, DEFAULT_CONFIG);
  supplied.id = 'example-all-comic'; supplied.builtin = true;
  const samples = EXAMPLES.map(([id, name, description, card, author_note, comic_author_note = '']) => {
    const preset = normalizeSettingsPreset({ name, description, settings: { card: { ...DEFAULT_CONFIG.card, comic_gen: 'off', comic_gen_ratio: 0, comic_prompt_prefix: '', comic_prompt_suffix: '', comic_author_note, ...card }, nai: DEFAULT_CONFIG.nai }, prompts: { author_note, asset_author_note: '', global_author_note: '' } }, DEFAULT_CONFIG);
    return { ...preset, id: `example-${id}`, builtin: true };
  });
  return [supplied, ...samples];
}
