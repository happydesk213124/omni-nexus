/**
 * 뷰어 및 감정 에셋 help, shown by the settings head's 「?」 like the BGM·효과음 rows.
 * Keyed by the control id inside each row.
 */
export const EMOTION_HELP: Record<string, { title: string; body: string }> = {
  'emo-size': { title: '글자 크기', body: '옴니 뷰어 대사 상자의 글자와 이름표 크기입니다. 다음에 뷰어를 열 때부터 적용됩니다.' },
  'emo-speed': { title: '글자 속도', body: '대사가 한 글자씩 나오는 빠르기입니다. 「즉시」는 한 번에 다 보입니다. 터치나 Enter를 누르면 나오던 줄은 바로 다 보입니다.' },
  'emo-skip': { title: '장면으로 띄우지 않을 단어', body: '이 단어가 들어간 줄은 뷰어의 장면이 되지 않습니다(채팅에는 그대로 보입니다). 상태창·OOC 같은 줄을 빼는 데 씁니다. 쉼표로 구분합니다.' },
  'emo-places': { title: '장소 배경', body: '장면의 장소에 맞는 사람 없는 배경을 뷰어 뒤에 흐리게 깝니다. 배경은 NAI V5 medium, 가로 1216×832, WebP로 그려 이 봇의 에셋에 omni_bg_태그 이름으로 저장하고, 같은 장소면 다시 그리지 않고 씁니다. 그리기는 「감정 에셋 → 없는 그림 자동 생성」을 따릅니다. 끄면 아래 배경 설정은 회색으로 잠깁니다.' },
  'emo-place-module': { title: '장소 태그 쓰게 하기 · ⚛️ omni place', body: '켜면 ⚛️ omni place 모듈이 설치되어 응답이 장소가 바뀔 때마다 [[place:cafe, indoors, window, daytime]] 같은 줄을 씁니다. 채팅에는 보이지 않고, 뷰어는 그 줄에 오면 배경을 바꿉니다(BGM 태그처럼). 장소 태그가 있으면 그 태그로 배경을 그립니다. 끄면 모듈은 남아 있지만 꺼집니다.' },
  'emo-bg-pick': { title: '장소 없는 메시지', body: '장소 태그(또는 캐스트 블록·삽화의 장소)가 없는 응답은 그 내용을 보고 이 봇의 배경과 샘플 장소 중에서 고릅니다. 메시지마다 한 번만 묻고 기억합니다. 「자동」은 JEV 키가 있으면 JEV, 없으면 임베딩입니다. 「고르지 않음」은 세션 작가노트의 장소를 쓰고, 그것도 없으면 이전 배경을 그대로 둡니다.' },
  'emo-enabled': { title: '감정 에셋 사용', body: '옴니 뷰어가 말하는 캐릭터의 표정 그림(스탠딩)을 띄웁니다. 끄면 이름이 적힌 타원으로 보입니다.' },
  'emo-existing': { title: '봇에 있는 기존 에셋 쓰기', body: '봇의 에셋·감정 이미지·켜진 모듈에서 이름_감정, 감정_이름, 별칭 같은 이름의 그림을 찾아 씁니다. Omni가 그린 그림은 omni_이름_감정으로 저장되어 섞이지 않습니다.' },
  'emo-auto': { title: '없는 그림 자동 생성', body: '뷰어에 필요한데 없는 표정·배경을 NovelAI로 그립니다. 기본 표정을 먼저 보여 주고 다 되면 바꿉니다. NAI가 쉴 때 다음 답장 것을 미리 그리는 것은 무료 생성일 때만입니다.' },
  'emo-family': { title: '모델', body: '표정 그림을 그릴 NovelAI 모델입니다. 배경은 이 설정과 상관없이 V5 medium으로 그립니다(V5 키가 없으면 기본 모델).' },
  'emo-transparent': { title: '투명 배경', body: 'V5에서 표정 그림의 배경을 투명하게 그립니다. 뷰어의 배경 위에 자연스럽게 섭니다.' },
  'emo-width': { title: '가로', body: '표정 그림의 가로 크기입니다(64 단위).' },
  'emo-height': { title: '세로', body: '표정 그림의 세로 크기입니다(64 단위).' },
  'emo-prefix': { title: '선행 프롬프트', body: '표정 그림 프롬프트 맨 앞에 붙습니다. 외형은 삽화 캐릭터 탭의 태그를 그대로 쓰고, 스타일 프리셋은 지금 켜진 것을 씁니다.' },
  'emo-pose': { title: '자세 태그', body: '스탠딩 자세 태그입니다. 비우면 기본 자세를 씁니다.' },
  'emo-suffix': { title: '후행 프롬프트', body: '표정 그림 프롬프트 맨 뒤에 붙습니다.' },
  'emo-words': { title: '단어 더하기', body: '대사 앞 (표정) 단어를 기본 감정으로 묶습니다. 한 줄에 하나, 단어=감정 꼴입니다(예: pouting=sad).' },
};
