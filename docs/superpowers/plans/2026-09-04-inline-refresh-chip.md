# Inline Refresh Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인라인 칩 줄에 `🔃` 새로고침을 하나 더 달고, 그 말풍선 DOM의 스피너·사진만 지운 뒤 이미 연결된 카드(및 진행 중 스피너)를 다시 붙인다. 해시 끊기·LLM 태그·잡 생성은 하지 않는다.

**Architecture:** 칩은 이미 `vite.config.ts`의 `injectChatMsgActions` / `runMsgChipAction` 패치에 산다. 클릭 키는 라벨이 아니라 `x-inlay-msg-chip`. 새 kind `refresh`를 시그니처·라벨·디스패치에 넣고, 태그 칩의 `nxRemoveInlineFrames*`만 재사용한다. 다시 붙이기는 기존 `refreshSelectedInlineImages(true, { onlySel: true })`다. `Be(..., true)`는 호출하지 않는다.

**Tech Stack:** Vite asserted vendor patches (`vite.config.ts`), `tests/build-layout.test.mjs` 문자열 가드, `npm run build` → `dist/inlaynexus2.0.js`.

## Global Constraints

- `vendor/inlay-nexus-ui.js`와 `dist/`를 손으로 편집하지 않는다. 항상 `npm run build`.
- 스토리지 키·플러그인 id를 바꾸지 않는다.
- 백엔드 라우트·parity 시나리오를 추가하지 않는다. 이 칩은 DOM만 건드린다.
- `Be(` / `unlink` / `POST /v1/jobs/create` / `force` 태그 경로를 refresh에서 부르지 않는다.
- 위 바 600자 / 아래 바 20자, 잡 `error` 1초 정리는 이미 있다. 이 계획에서 다시 열지 않는다.

## File map

| File | Role |
|---|---|
| `vite.config.ts` | `wantSig`, `chipKinds`, `chipLabels`, `chipCss`, `runMsgChipAction("refresh")` |
| `tests/build-layout.test.mjs` | 시그니처·라벨·디스패치·금지 호출 assert |
| `docs/UI-CONTRACT.md` | 칩 목록과 refresh 의미 한 단락 |
| `dist/inlaynexus2.0.js` | 빌드 결과물만 |

## What refresh is / is not

**한다**

1. 칩이 달린 DOM 슬롯을 선택한다. 기존 `runMsgChipAction`이 이미 `Da(idx, els, { source: "provisional" })`로 그 말풍선을 `t.selectedMessage`에 맞춘다.
2. 그 말풍선에서 인라인 프레임을 버린다: `nxRemoveInlineFrames(els[idx])` + `nxRemoveInlineFramesByKey(t.hostDoc, ye(nxInlineStampKey(A)))`.
3. `_inlineNeedStamp` / `_inlineNeedStampKey`를 태그 칩과 같이 켠다. 다음 페인트가 `canSkipInlineInject`로 빈 말풍선을 건너뛰지 않게 하기 위함이다.
4. `await refreshSelectedInlineImages(!0, { onlySel: !0 })` — 선택 말풍선만. 링크된 카드와 `nxPendingForInlineSelection` 스피너를 다시 심는다.

**하지 않는다**

- `Be(await Z({ useOverride: !1 }), A.text, !0)` (태그 강제 = LLM + 해시 작업)
- `rerollMessageImagesLive` / `POST /v1/jobs/create`
- `unlink` / `gallery.unlink` / 카드 `content_hash` 변경
- 이웃 말풍선 프레임 삭제 (`onlySel: true`)

카드가 없으면 비운 채로 끝난다. `inline_chat_images`가 꺼져 있으면 `refreshSelectedInlineImages`가 조기 return하므로, 그 경우에도 2번 비우기는 먼저 실행한다.

## Visual

- 위치: 기존 다섯 개 **뒤**. `태그 재생성 중단 캐릭터 프리셋 🔃`
- 라벨: `🔃`만. 다른 칩 한글은 유지.
- 스타일: `tag`와 같은 테두리(`rgba(63,140,120,.42)`). 패딩은 기존 `7px 14px` 유지. 이모지 한 글자라 줄이 더 컴팩트하다. 전체 칩 패딩을 줄이지 않는다.
- `flex-wrap`이 이미 있어 좁은 말풍선은 줄바꿈.

---

### Task 1: 가드가 먼저 실패하게

**Files:**
- Modify: `tests/build-layout.test.mjs` (in-message action bar 테스트 근처, `chipLabels` assert)
- Modify: `docs/UI-CONTRACT.md` (칩 문단)

**Interfaces:**
- Consumes: 현재 `wantSig = "tag|regen|stop|char|preset"`
- Produces: 테스트가 새 시그니처·refresh 디스패치·`Be(` 금지를 요구함

- [ ] **Step 1: 실패하는 build-layout assert를 넣는다**

`tests/build-layout.test.mjs`의

```js
assert.match(body, /chipLabels = \{ tag: "태그", regen: "재생성", stop: "중단", char: "캐릭터", preset: "프리셋" \}/);
```

를 아래로 교체한다.

```js
assert.match(body, /const wantSig = "tag\|regen\|stop\|char\|preset\|refresh"/);
assert.match(body, /chipKinds = \["tag", "regen", "stop", "char", "preset", "refresh"\]/);
assert.match(body, /chipLabels = \{ tag: "태그", regen: "재생성", stop: "중단", char: "캐릭터", preset: "프리셋", refresh: "🔃" \}/);
assert.match(body, /if \(kind0 === "refresh"\)/);
assert.match(body, /refreshSelectedInlineImages\(!0, \{ onlySel: !0 \}\)/);
const refreshFrom = body.indexOf('if (kind0 === "refresh")');
const refreshTo = body.indexOf('if (kind0 === "char")', refreshFrom);
const refresh = refreshFrom >= 0 && refreshTo > refreshFrom ? body.slice(refreshFrom, refreshTo) : "";
assert.ok(refresh.length > 40, "refresh chip dispatch missing");
assert.match(refresh, /nxRemoveInlineFrames\(els\[idx\]\)/);
assert.match(refresh, /nxRemoveInlineFramesByKey/);
assert.match(refresh, /t\._inlineNeedStamp = !0/);
assert.doesNotMatch(refresh, /await Be\(/);
assert.doesNotMatch(refresh, /rerollMessageImagesLive/);
assert.doesNotMatch(refresh, /\/v1\/jobs\/create/);
```

`docs/UI-CONTRACT.md` 칩 문단에 한 줄 추가한다.

```
The sixth chip is `refresh` (`🔃`). It abandons inline frames on that DOM
bubble and restamps from linked cards / pending spinners. It does not unlink
hashes and does not start a tagger job.
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run:

```
node --test tests/build-layout.test.mjs --test-name-pattern "in-message action bar"
```

Expected: FAIL. `chipLabels` / `wantSig`가 아직 다섯 개.

- [ ] **Step 3: 커밋하지 않는다.** 구현이 Task 2다.

---

### Task 2: 칩 줄에 `refresh`를 넣고 클릭을 연결

**Files:**
- Modify: `vite.config.ts` — `injectChatMsgActions` 패치 블록 (`wantSig` ~ `chipLabels`, `chipCss`)
- Modify: `vite.config.ts` — `runMsgChipAction` (`kind0 === "tag"` 다음 또는 `"char"` 앞)
- Modify: `vite.config.ts` — `patchVendor` 후 assert (시그니처 문자열 존재, refresh 블록에 `Be(` 없음)

**Interfaces:**
- Consumes: `nxRemoveInlineFrames`, `nxRemoveInlineFramesByKey`, `nxInlineStampKey`, `ye`, `refreshSelectedInlineImages`
- Produces: `x-inlay-msg-chip="refresh"`, `wantSig`에 `refresh` 포함. 기존 다섯 개 바와 시그니처가 달라져 한 번 다시 그린다.

- [ ] **Step 1: 라벨·시그니처**

`vite.config.ts`에서 다음을 정확히 바꾼다.

```js
const wantSig = "tag|regen|stop|char|preset|refresh";
```

```js
const chipCss = (kind) => kind === "char" || kind === "preset"
  ? chipBase + ";border:1px solid rgba(196,181,253,.45)"
  : kind === "tag" || kind === "refresh"
  ? chipBase + ";border:1px solid rgba(63,140,120,.42)"
  : kind === "stop"
  ? chipBase + ";border:1px solid rgba(176,92,92,.40)"
  : chipBase + ";border:1px solid rgba(167,139,250,.48)";
const chipKinds = ["tag", "regen", "stop", "char", "preset", "refresh"];
const chipLabels = { tag: "태그", regen: "재생성", stop: "중단", char: "캐릭터", preset: "프리셋", refresh: "🔃" };
```

`chipNodes.length !== chipKinds.length` 가드는 그대로 두면 6개를 요구한다.

- [ ] **Step 2: 디스패치**

`runMsgChipAction`에서 `kind0 === "tag"` 블록 **다음**, `kind0 === "regen"` 앞에 넣는다. 태그 블록을 복사하지 말고 아래를 그대로 쓴다.

```js
    if (kind0 === "refresh") {
      try {
        const stampKey = nxInlineStampKey(A);
        t._inlineNeedStamp = !0;
        t._inlineNeedStampKey = stampKey;
        if (els[idx]) await nxRemoveInlineFrames(els[idx]);
        if (stampKey) await nxRemoveInlineFramesByKey(t.hostDoc, ye(stampKey));
        await refreshSelectedInlineImages(!0, { onlySel: !0 });
        y("info", "msg.refresh", "msg-actions");
      } catch (err) { y("error", "msg.refresh.fail", err?.message || err); }
      return;
    }
```

`A`가 없어도 프레임 삭제는 `els[idx]`로 한다. `nxInlineStampKey(A)`는 `A` 없으면 빈 키 → byKey는 스킵. `refreshSelectedInlineImages`는 `t.selectedMessage`가 있을 때만 다시 붙인다. `Da`를 이미 호출한 뒤라 보통 있다.

- [ ] **Step 3: 빌드 assert**

`patchVendor`의 msg-action 검사 근처에 추가한다.

```js
if (!out.includes('const wantSig = "tag|regen|stop|char|preset|refresh"')
  || !out.includes('if (kind0 === "refresh")')
  || !out.includes('refreshSelectedInlineImages(!0, { onlySel: !0 })')) {
  throw new Error('[build] msg-action refresh chip missing');
}
{
  const from = out.indexOf('if (kind0 === "refresh")');
  const to = out.indexOf('if (kind0 === "regen")', from);
  const body = from >= 0 && to > from ? out.slice(from, to) : '';
  if (!body.includes('nxRemoveInlineFrames(els[idx])') || body.includes('await Be(')) {
    throw new Error('[build] refresh chip must restamp without Be()');
  }
}
```

- [ ] **Step 4: 테스트 → 빌드**

```
node --test tests/build-layout.test.mjs --test-name-pattern "in-message action bar"
npm test
```

Expected: unit/build/audit/smoke/bench/parity 통과. parity는 API 불변.

- [ ] **Step 5: 커밋 (사용자가 요청할 때만)**

```
git add vite.config.ts tests/build-layout.test.mjs docs/UI-CONTRACT.md dist/inlaynexus2.0.js
git commit -m "Add inline refresh chip that restamps frames without unlinking."
```

`dist/inlaynexus2.0.js`는 `npm run build` 결과만 포함한다.

---

## Manual check (구현 후)

1. 카드가 있는 캐릭터 말풍선: `🔃` → 사진이 잠깐 사라지고 같은 카드가 다시 붙는다. 갤러리 id·해시 불변.
2. 생성 중 스피너만 있는 말풍선: 스피너가 지워졌다가 pending이 같으면 다시 돈다. 새 잡이 안 생긴다.
3. 카드 없는 말풍선: 프레임만 사라지고 끝.
4. 태그 칩: 여전히 LLM 강제 태그.
5. 위 바는 600자 이상일 때만, 아래 바는 20자면. refresh도 같은 줄에 같이 달린다.

## Out of scope

- 칩 전체를 이모지로 바꾸기
- 위/아래 글자수 재조정
- 잡 JSON 에러 경로
- 채팅 스크롤 SafeElement release (B-1)

## Spec coverage

| 요청 | Task |
|---|---|
| 칩 하나 추가, 컴팩트 이모지 | Task 2 Step 1 |
| 태그처럼 DOM 비우기 | Task 2 Step 2 `nxRemoveInlineFrames*` |
| 해시 끊지 않음 | Task 1/2 `Be(` 금지 |
| 스피너·이미지 다시 붙이기 | Task 2 `refreshSelectedInlineImages(!0, { onlySel: !0 })` |
| 가드 | Task 1 + build assert |
