type Tip = { title: string; body: string };

/**
 * BGM·효과음 help, shown by the settings head's 「?」 like the TTS rows: the
 * pages stay short and every row still explains itself on demand. Keyed by the
 * control id inside each row.
 */
export const SOUND_HELP: Record<string, Tip> = {
  'snd-bgm-enabled': { title: 'BGM 사용', body: '켜면 ⚛️ omni bgm 모듈이 설치되고 [[bgm:…]] 줄이 ♪ 버튼이 됩니다. 끄면 아래 BGM 설정은 회색으로 잠깁니다(값은 그대로).' },
  'snd-bgm-volume': { title: 'BGM 볼륨', body: 'BGM만의 볼륨입니다. 플로팅 뷰어 BGM 바의 볼륨과 같은 값입니다.' },
  'snd-duck': { title: 'TTS 재생 중 BGM', body: 'TTS가 말하는 동안 BGM을 이만큼으로 줄입니다. 말이 끝나면 원래 볼륨으로 돌아옵니다.' },
  'snd-crossfade': { title: '곡 전환', body: '곡이 바뀔 때 앞 곡을 줄이며 다음 곡을 키우는 시간입니다. 0이면 바로 바뀝니다.' },
  'snd-bgm-prompt': { title: 'LLM에게 BGM 태그 요청', body: '곡이 바뀔 만할 때만(이 채팅의 첫 장면, 분위기·장소가 확 바뀔 때) 그 부분의 첫 나레이션·대사 바로 앞 줄에 [[bgm:분위기,장소,템포]]를 쓰게 합니다. 같은 분위기가 이어지면 쓰지 않고 곡이 계속 흐릅니다(답변당 최대 3개). 곡 목록은 보내지 않습니다.' },
  'snd-list-bgm': { title: 'TTS 읽는 위치의 BGM 자동 전환', body: 'TTS 뷰어 목록에 ♪ 줄이 생기고, 이어 읽다가 그 줄에 오면 곡이 바뀝니다. 플로팅 뷰어 BGM 바의 「자동」과 같은 설정입니다. 끄면 새 답변이 올 때 첫 태그로만 바뀝니다.' },
  'snd-bgm-matcher': { title: '곡 고르는 방식', body: '자동은 용어집 → JEV → 임베딩 → 이름·태그 글자 순으로 찾습니다. 키가 없는 단계는 건너뜁니다. 「용어집·글자만」은 요청 없이 무료로 고릅니다.' },
  'snd-bgm-basis': { title: '곡을 고르는 근거', body: '「태그 + 메시지」는 태그를 힌트로 함께 보냅니다. 메시지 전체로 고를 때는 응답 본문(생각·이미지 표시 제외, 최대 4000자)을 JEV·LLM에 보내 곡 하나를 고릅니다. 같은 응답은 한 번만 묻습니다.' },
  'snd-bgm-tags': { title: 'BGM 태그 목록', body: '쉼표로 구분합니다. LLM은 [[bgm:…]]를 쓸 때 이 안에서만 고릅니다.' },
  'snd-sfx-enabled': { title: '효과음 사용', body: '켜면 ⚛️ omni 효과음 모듈이 설치되고 규칙에 걸린 말에 회색 ▶ 버튼이 붙습니다. 끄면 아래 효과음 설정은 회색으로 잠깁니다(값은 그대로).' },
  'snd-sfx-volume': { title: '효과음 볼륨', body: '효과음만의 볼륨입니다.' },
  'snd-sfx-normalize': { title: '효과음 크기 자동 맞추기', body: '효과음마다 다른 크기를 같은 크기로 맞춥니다(TTS 자동 맞추기와 같은 역할). 소리가 찢어지지 않게 최고 음량은 넘지 않습니다.' },
  'snd-sfx-first': { title: '▶를 다른 모듈보다 먼저 붙이기', body: '다른 모듈이 §쾅§를 자기 모양(상자 등)으로 바꿔도 ▶가 생깁니다. 다른 모듈의 표시가 깨지면 끄세요.' },
  'snd-sfx-trim': { title: '앞뒤 무음 건너뛰기', body: '파일 앞뒤의 소리 없는 부분을 빼고 바로 재생합니다.' },
  'snd-sfx-max': { title: '효과음 최대 길이', body: '이보다 길면 부드럽게 줄이며 끊습니다. 0.5초 단위로 적을 수 있고, 0이면 끝까지 재생합니다.' },
  'snd-sfx-cue': { title: 'LLM에게 효과음 표시 요청', body: '소리가 나는 곳에 §쾅§처럼 쓰게 합니다(답변당 최대 5개). 켜진 첫 규칙의 앞·뒤 글자로 쓰고, 효과음은 대사·나레이션과 따로 한 줄에 쓰게 합니다. 아래 줄에 마지막 요청에 지시가 들어갔는지 나옵니다.' },
  'snd-list-sfx': { title: 'TTS 목록·이어 읽기에 효과음', body: 'TTS 뷰어 목록에 ▶ 줄이 생기고, 이어 읽다가 그 줄에 오면 효과음을 틀고 끝나면 다음 대사로 넘어갑니다.' },
  'snd-sfx-auto': { title: '자동 재생', body: '「새 답변 · 이어 읽기 중」은 새 답변이 올 때와 이어 읽는 중에 효과음을 틉니다. 「버튼을 눌렀을 때만」은 ▶를 누를 때만 틉니다.' },
  'snd-sfx-matcher': { title: '효과음 고르는 방식', body: '자동은 용어집 → JEV → 임베딩 → 이름·태그 글자 순으로 찾습니다. 키가 없는 단계는 건너뜁니다. JEV가 고른 답만 용어집에 배워 둡니다.' },
  'snd-sfx-autocreate': { title: '맞는 효과음이 없으면 ElevenLabs로 만들기', body: 'JEV·LLM이 "맞는 게 없다"고 답한 말만 만듭니다(유료). 만든 효과음은 「자동 생성」 폴더와 용어집에 들어갑니다. 끄면 가장 비슷한 효과음을 틉니다.' },
  'snd-sfx-duration': { title: '생성 길이', body: 'ElevenLabs로 만드는 효과음의 길이(초)입니다. 0이면 ElevenLabs가 알맞게 정합니다.' },
  'snd-rules-head': { title: '효과음 규칙', body: '앞 글자와 뒤 글자 사이의 말이 효과음이 됩니다(예: 앞 § · 뒤 § → §쾅§). 켜진 규칙만 쓰고, LLM에게 효과음 표시를 요청할 때는 켜진 첫 규칙의 글자를 씁니다. 줄 오른쪽에 그 규칙으로 쓴 예가 보입니다.' },
  'snd-settings-export': { title: 'BGM·효과음 설정 파일', body: '이 화면의 설정(볼륨·고르는 방식·태그 목록·효과음 규칙 등)을 JSON 하나로 옮깁니다. ElevenLabs·임베딩 키는 담지 않고, 불러와도 BGM·효과음 사용 스위치는 그대로입니다. 곡·효과음 목록은 각 목록의 「파일 ⋯」로 옮깁니다.' },
  'snd-bgm-cache': { title: 'BGM 기기 저장', body: '한 번 들은 곡(과 미리 받은 곡)을 이 기기에 두어, 새로 고침 뒤에도 바로 재생합니다. 저장 파일·동기화에는 들어가지 않고, 넘치면 오래 안 들은 곡부터 지웁니다. 0이면 기기에 두지 않습니다.' },
  'snd-eleven-key': { title: 'ElevenLabs API Key', body: '효과음·BGM을 ElevenLabs로 만들 때만 씁니다(유료).' },
  'snd-embed-provider': { title: '임베딩 제공자', body: '「자동」 고르기에서 JEV 다음에 쓰는 임베딩입니다. 말의 뜻이 가까운 효과음·곡을 고릅니다.' },
  'snd-embed-model': { title: '임베딩 모델', body: '제공자를 바꾸면 그 제공자의 기본 모델로 바뀝니다. 직접 적은 모델은 그대로 둡니다.' },
  'snd-embed-key': { title: '임베딩 API Key', body: '제공자의 API 키입니다. OpenRouter는 비우면 JEV 키를 씁니다.' },
  'snd-embed-endpoint': { title: '임베딩 주소', body: '비우면 제공자의 기본 주소를 씁니다. 프록시나 직접 띄운 서버만 적습니다.' },
  'snd-max-mb': { title: '파일 최대 크기', body: '파일은 모듈에 저장되어 저장 파일·동기화 크기가 늘어납니다. 큰 곡은 주소로 등록하세요.' },
};

export function soundHelpTip(id: string): Tip | undefined { return Object.prototype.hasOwnProperty.call(SOUND_HELP, id) ? SOUND_HELP[id] : undefined; }

/** Pins each row to the control its tip describes, as the TTS rows are. */
export function attachSoundHelp(root: ParentNode): void {
  for (const id of Object.keys(SOUND_HELP)) {
    const control = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    const host = control?.closest<HTMLElement>('.row, .field, .snd-rules-head');
    if (host && !host.dataset.nxHelpId) host.dataset.nxHelpId = id;
  }
}
