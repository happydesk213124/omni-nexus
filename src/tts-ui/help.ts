type Tip = { title: string; body: string };

// Keyed by the control id inside each row; the head help resolves rows by it.
export const TTS_HELP: Record<string, Tip> = {
  'tts-power': { title: 'TTS 사용', body: '켜면 OmniTTS 표시 모듈이 설치되고 채팅 줄 끝에 재생 버튼이 붙습니다. 삽화 전원과는 따로 동작합니다.' },
  'audio-enable-settings': { title: '음성 재생 활성화', body: '브라우저는 사용자가 한 번 눌러야 소리를 냅니다. 처음 한 번만 누르면 이후 채팅 버튼으로 바로 재생됩니다.' },
  speed: { title: '음성 배속', body: '재생 속도입니다. 이미 만든 음성에도 바로 적용되고 캐시는 다시 만들지 않습니다.' },
  'speed-presets': { title: '커스텀 배속 목록', body: '플로팅 뷰어의 배속 버튼에 나올 값입니다. 쉼표로 구분해 0.25~4 사이 숫자를 적습니다.' },
  volume: { title: '재생 볼륨', body: 'TTS 음성만의 볼륨입니다. 캐릭터별 음량 보정(dB)과 함께 적용됩니다.' },
  'tts-normalize': { title: '목소리 크기 자동 조절', body: 'Fish가 음성마다 크기를 맞춰서 생성합니다. 바꾸면 새로 만드는 음성부터 적용됩니다.' },
  'click-play': { title: '버튼 눌렀을 때 재생하기', body: '채팅 줄 끝의 ▶ 버튼을 누르면 그 줄을 읽습니다. 끄면 버튼은 보이지만 눌러도 읽지 않습니다.' },
  'hover-play': { title: '마우스오버 시 바로 재생하기', body: 'PC에서 ▶ 버튼 위에 마우스를 올리기만 해도 읽습니다.' },
  'auto-play': { title: '새 답변 완료 후 자동 재생', body: '새 답변이 끝나면 첫 대사부터 읽습니다. 다른 모듈이 상태창 등으로 바꾼 줄은 건너뜁니다.' },
  'illustration-read': { title: '옴니 삽화 텍스트 읽기', body: '삽화 아래 초록 ▶ 버튼을 보여 줍니다. NAI5 대사삽입으로 만든 삽화의 대사를 캐릭터 목소리로 읽습니다.' },
  continuous: { title: '다음 구간 이어 읽기', body: '한 줄이 끝나면 같은 메시지의 다음 줄을 이어서 읽습니다.' },
  narration: { title: '나레이션 읽기', body: '대사가 아닌 서술 줄에도 파란 ▶ 버튼을 보여 주고 읽습니다. 나레이션 음성은 음성 목록에서 지정합니다.' },
  'tts-skip-chars': { title: '생성에서 제외할 글자 수', body: '공백·문장부호를 뺀 글자가 이 수 이하인 줄은 버튼과 목록에서 빠지고 음성도 만들지 않습니다.' },
  'strip-brackets': { title: '[ ] 괄호 빼고 읽기', body: '켜면 [ ] 【 】 괄호를 빼고 Fish에 보냅니다. 예: [00:00 - SHOOTING FINISHED] → 00:00 - SHOOTING FINISHED. 숫자·기호만 있는 줄([00:10… 00:09…])은 이 설정과 상관없이 버튼도 음성도 만들지 않습니다.' },
  'tts-exclude-text': { title: '이 텍스트 포함하면 생성 안 함', body: '쉼표로 구분한 글자 중 하나라도 들어간 대사·나레이션은 재생 버튼, 목록, 음성 생성에서 모두 빠집니다. 대시보드의 같은 칸과 연결되어 있습니다.' },
  'nx-tts-exclude-text': { title: 'TTS 생성 제외 텍스트', body: '쉼표로 구분한 글자 중 하나라도 들어간 대사·나레이션은 TTS 재생 버튼, 목록, 음성 생성에서 빠집니다. TTS 설정의 같은 칸과 연결되어 있습니다.' },
  floating: { title: 'TTS 플로팅 뷰어', body: '채팅 화면에 재생·배속·목록을 다루는 작은 창을 띄웁니다. 머리 부분을 끌어서 옮길 수 있습니다.' },
  'hide-name': { title: '화자 이름 숨기기', body: '화면에서 “이름 (억양):” 머리말의 이름을 숨깁니다. 다른 모듈이 모두 처리한 뒤 마지막에만 적용되어 원문과 다른 모듈은 그대로입니다.' },
  'hide-tone': { title: '억양 숨기기', body: '화면에서 (happy) 같은 영어 억양 표시를 숨깁니다. 음성 생성에는 계속 쓰입니다.' },
  'tts-toast-enabled': { title: 'TTS 전용 알림', body: '음성을 만드는 동안 진행 상황을 작게 알려 줍니다. 재생 실패 안내는 이 설정과 상관없이 보입니다.' },
  'auto-voice': { title: '새 캐릭터 음성 자동 배정', body: '처음 나온 화자에게 음성 목록에서 어울리는 목소리를 골라 줍니다.' },
  'voice-selector-engine': { title: '음성 선택 모델', body: '자동 배정에 쓸 모델입니다. TTS 보조 LLM 또는 JEV 중에서 고릅니다.' },
  translation: { title: '번역 방식', body: '읽기 전에 대사를 다른 언어로 번역합니다. 화면 글자는 그대로이고 음성만 번역됩니다.' },
  language: { title: '도착 언어', body: '대사를 번역할 언어입니다. 출발 언어는 자동 감지합니다.' },
  'custom-lang': { title: '언어 코드', body: 'fr, de, zh 같은 언어 코드를 적습니다.' },
  'narration-language': { title: '나레이션 도착 언어', body: '나레이션만 다른 언어로 듣고 싶을 때 고릅니다. 「대사와 같음」은 위 도착 언어를, 「번역 안 함」은 원문을 그대로 읽습니다.' },
  'narration-custom-lang': { title: '나레이션 언어 코드', body: '나레이션에 쓸 언어 코드(fr, de, zh 등)를 적습니다.' },
  'tts-google-key': { title: 'Google API Key', body: 'Google Cloud Translation API를 고른 경우에만 필요합니다.' },
  'tts-deepl-plan': { title: 'DeepL 플랜', body: 'DeepL 키가 Free인지 Pro인지 고릅니다. 요청 주소가 달라집니다.' },
  'tts-deepl-key': { title: 'DeepL API Key', body: 'DeepL API를 고른 경우에만 필요합니다.' },
  'translation-model': { title: 'LLM 번역 모델', body: '번역에 쓸 LLM입니다. 위 보조 LLM 연결 또는 Risu 모델을 그대로 쓸 수 있습니다.' },
  'tts-translation-url': { title: '번역 API URL', body: '사용자 지정 번역 LLM의 OpenAI 호환 주소입니다.' },
  'tts-translation-model': { title: '번역 모델 이름', body: '사용자 지정 번역 LLM의 모델 이름입니다.' },
  'tts-translation-key': { title: '번역 API Key', body: '사용자 지정 번역 LLM의 API 키입니다.' },
  prefetch: { title: '미리 만들기', body: '화면 주변의 줄을 이 수만큼 미리 만들어 둡니다. 0이면 누를 때만 만듭니다.' },
  concurrency: { title: 'Fish TTS 최대 동시 요청', body: 'Fish에 동시에 보내는 요청 수입니다. 직접 누른 줄이 항상 먼저 처리됩니다.' },
  'background-concurrency': { title: '백그라운드 동시 생성', body: '미리 만들기에 쓸 수 있는 요청 수입니다. 최대 동시 요청보다 클 수 없습니다.' },
  'cache-limit': { title: '음성 캐시 최대 용량', body: '만든 음성을 기기에 저장해 다시 쓰는 용량입니다. 넘으면 오래된 것부터 지웁니다.' },
  'clear-cache': { title: '캐시 비우기', body: '저장된 음성과 번역 결과를 모두 지웁니다.' },
  'tts-fish-key': { title: 'Fish API Key', body: 'fish.audio에서 발급한 API 키입니다. 음성 생성에 꼭 필요합니다.' },
  'tts-fish-url': { title: 'Fish API URL', body: '보통 기본값을 그대로 둡니다. 프록시를 쓸 때만 바꿉니다.' },
  'tts-fish-model': { title: '음성 생성 모델', body: 'Fish 음성 모델입니다. 바꾸면 새로 만드는 음성부터 적용됩니다.' },
  'tts-test-fish': { title: '연결 테스트', body: '입력한 키와 주소로 Fish에 실제로 접속되는지 확인합니다.' },
  'helper-model': { title: '보조 LLM 제공자', body: '새 화자의 음성 고르기와 LLM 작업에 쓸 모델입니다. Risu 모델을 그대로 쓸 수도 있습니다.' },
  'tts-llm-model': { title: '모델 이름', body: '보조 LLM 모델 이름입니다.' },
  'tts-llm-url': { title: 'API URL', body: '보조 LLM 주소입니다.' },
  'tts-llm-key': { title: 'API Key', body: '보조 LLM API 키입니다.' },
  'tts-test-llm': { title: '연결 테스트', body: '보조 LLM에 실제로 요청을 보내 응답을 확인합니다.' },
  'jev-provider': { title: 'JEV 연결 사이트', body: '음성 프리셋 선택용 JEV를 어디서 부를지 고릅니다.' },
  'jev-model': { title: 'JEV 모델명', body: 'JEV 모델 이름입니다.' },
  'jev-url': { title: 'JEV 요청 URL', body: 'JEV 요청을 보낼 전체 주소입니다.' },
  'jev-format': { title: 'JEV API 형식', body: '연결 사이트에 맞는 요청 형식을 고릅니다.' },
  'jev-key': { title: 'JEV API Key', body: 'JEV 요청에 쓰는 API 키입니다.' },
  'tts-test-jev': { title: '연결 테스트', body: 'JEV에 실제로 요청을 보내 응답을 확인합니다.' },
  'tts-test-translation': { title: '연결 테스트', body: '선택한 번역 방식으로 짧은 문장을 번역해 봅니다.' },
};

export function ttsHelpTip(id: string): Tip | undefined { return Object.prototype.hasOwnProperty.call(TTS_HELP, id) ? TTS_HELP[id] : undefined; }

/** Rows hold several ids; pin each row to the control its tip describes. */
export function attachTtsHelp(root: ParentNode): void {
  for (const id of Object.keys(TTS_HELP)) {
    const control = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    const host = control?.closest<HTMLElement>('.row, .field, label.switch, .actions');
    if (host && !host.dataset.nxHelpId) host.dataset.nxHelpId = id;
  }
}
