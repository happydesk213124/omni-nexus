// Reusable texts for the main tagger's author's note (`author_note`).
// The examples are written against the tagger's real output contract
// (prompts/tagger.txt, format.txt): `camera` lands in the main prompt, each
// entry of `characters[]` becomes its own NAI character caption with the
// registered looks prepended, and 1girl/1boy are counted from that cast only.

export interface AuthorNotePreset {
  id: string;
  name: string;
  text: string;
  builtin?: boolean;
}

export const AUTHOR_NOTE_PRESET_TEXT_LIMIT = 20_000;
const LIMIT_ITEMS = 100;

/** Stored rows only; examples are never persisted, so a later release can improve them. */
export function normalizeAuthorNotePresets(raw: unknown): AuthorNotePreset[] {
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { items?: unknown } : null;
  const rows = Array.isArray(raw) ? raw : Array.isArray(rec?.items) ? rec.items : [];
  const out: AuthorNotePreset[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? '').trim().slice(0, 80);
    const name = String(r.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    // An example id must never be shadowed by a stored row.
    if (!id || !name || seen.has(id) || id.startsWith('example-')) continue;
    seen.add(id);
    out.push({ id, name, text: String(r.text ?? '').replace(/\r\n/g, '\n').trim().slice(0, AUTHOR_NOTE_PRESET_TEXT_LIMIT) });
    if (out.length >= LIMIT_ITEMS) break;
  }
  return out;
}

const POV_CORE = `카메라 = 시점 인물의 눈. 시점 인물은 1인칭 화자, 화자가 없으면 유저 페르소나입니다.
모든 샷의 camera에 pov를 넣고 거리·각도 태그를 함께 쓰세요: close-up, upper body, cowboy shot, from above(내려다볼 때), from below(올려다볼 때).

시점 인물을 characters[]에 넣을지:
- 몸이 화면에 안 보이는 샷(보기만 함): 넣지 마세요. 상대만 넣고, 상대가 시점 인물을 볼 때만 상대 action에 looking at viewer.
- 손·팔·다리·하반신이 보이는 샷: 넣으세요. 그래야 1girl, 1boy 인원 수가 맞고 source/target 접촉이 이어집니다.
  - action: 손이 보이면 pov hands, 하반신이 보이면 pov crotch, 그리고 head out of frame과 faceless male(여성이면 faceless female).
  - negative: face, eyes, hair — 얼굴과 머리가 그려지지 않게.
  - 손이 하는 일은 접촉 규칙대로: 시점 인물이 source, 상대가 target, 같은 동사(예: 둘 다 holding hands면 mutual).

시점 인물의 체형:
- 등록된 외형(체형·피부색)이 캡션에 자동으로 들어갑니다. 외형에 이미 있는 태그는 반복하지 마세요.
- 외형에 없는데 원문에서 보이는 몸 특징만 시점 인물 action에 덧붙이세요.
  - 남성: muscular male, veins, arm hair, hairy, fat man, fat, old man, wrinkled skin, dark-skinned male.
  - 여성: nail polish, fingernails, bracelet, dark-skinned female, plump, skinny.
- 체형 단서가 원문·외형 어디에도 없으면 아무것도 지어내지 마세요.

V5 natural: 시점 인물은 the viewer로 부르세요(예: the viewer's hand reaches in from the bottom edge). the viewer의 얼굴·머리는 묘사하지 마세요.`;

type Example = [id: string, name: string, text: string];
const EXAMPLES: Example[] = [
  ['pov', 'POV · 1인칭 시점', `[POV · 1인칭 시점]
${POV_CORE}`],
  ['pov-touch', 'POV · 손과 스킨십', `[POV · 손과 스킨십]
${POV_CORE}

이 프리셋은 손이 보이는 장면을 우선합니다:
- 원문에 시점 인물의 손이 닿는 행동(잡기, 쓰다듬기, 건네기, 안기)이 있으면 그 순간을 샷으로 고르세요.
- 손과 상대가 함께 들어오도록 close-up 또는 upper body로 잡고, 상대 action에는 반응(blush, surprised, looking at viewer, closed eyes)을 쓰세요.
- 상대 쪽 접촉 태그는 target으로: 예) 시점 인물 source: headpat → 상대 target: headpat.`],
  ['cinematic', '영화 같은 연출', `[영화 같은 연출]
한 메시지의 샷을 영화 컷처럼 구성하세요. 인접한 샷끼리 같은 거리·각도를 반복하지 마세요.
- 도입·장소 전환: camera에 wide shot 또는 full body, 공간이 읽히는 각도(from above, from side). aspect는 landscape. place에 장소·시간·광원을 구체적으로.
- 행동: cowboy shot 또는 upper body. 움직임이 크면 motion blur, 긴박하면 dutch angle, 원근을 살리면 foreshortening.
- 감정의 정점: close-up 또는 portrait, depth of field, blurry background. aspect는 portrait.
- 대화: 듣는 사람 뒤에서 말하는 사람을 잡는 from behind 구도와 정면 구도를 번갈아 쓰세요.
- 조명은 원문의 시간·광원에 맞는 것 1~2개: backlighting, rim lighting, sunlight, light rays, sunset, moonlight, dim lighting, silhouette, lens flare.
- 원문에 없는 사건·인물·소품은 연출을 위해서라도 만들지 마세요.`],
  ['emotion', '표정 클로즈업', `[표정 클로즈업]
말하는 인물과 듣는 인물의 반응을 중심으로 샷을 고르세요.
- camera: close-up, portrait 또는 upper body. 한 샷에 1~2명.
- action에 표정을 구체적으로: blush, light blush, tearing up, tears, furrowed brow, raised eyebrows, parted lips, pout, smirk, gentle smile, trembling.
- 시선을 반드시 적으세요: looking at another, looking away, looking down, averting eyes, eye contact(서로 볼 때 mutual 아님, 각자 action에).
- 손짓이 감정을 드러내면 함께: hand on own chest, covering mouth, clenched hand, fidgeting.
- 원문에 없는 감정이나 대사는 만들지 마세요.`],
  ['action', '액션 흐름', `[액션 흐름]
핵심 행동의 준비 → 실행 → 반응이 이어지도록 샷을 고르세요. complexity는 dynamic.
- camera: 준비는 full body 또는 cowboy shot, 실행은 dutch angle, from below, foreshortening, 반응은 upper body.
- action에 동세를 구체적으로: running, jumping, swinging, lunging, dodging, fighting stance, outstretched arm, dynamic pose.
- 속도감: motion blur, motion lines, speed lines. 충격은 눈에 보이는 것으로: debris, dust cloud, sparks.
- 무기·소품을 쓰는 인물은 weapon: on. 인물의 위치·이동 방향·소품은 샷 사이에 유지하고, 서로 다른 순간을 한 샷에 섞지 마세요.`],
  ['scenery', '풍경과 공간', `[풍경과 공간]
원문에 나온 장소와 분위기를 우선 샷으로 고르세요.
- camera: wide shot, scenery, 높은 곳이면 from above, 하늘·건물을 올려다보면 from below. aspect는 landscape.
- place에 구조·소재·시간대·날씨·빛을 구체적으로: night sky, starry sky, sunset, overcast, rain, fog, snow, cherry blossoms, city lights, light rays.
- 인물이 원문상 그 자리에 있으면 작게(very wide shot, from behind), 없으면 characters를 비우세요(no humans가 자동으로 붙습니다).
- 원문에 없는 인물·건물·소품은 추가하지 마세요.`],
];

export function authorNotePresetExamples(): AuthorNotePreset[] {
  return EXAMPLES.map(([id, name, text]) => ({ id: `example-${id}`, name, text, builtin: true }));
}
