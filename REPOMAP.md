# REPOMAP — Inlay Nexus 2.0

> **Read this first.** It is the structural map of the repo, written for whoever
> (human or LLM) has to change something. Every section answers "where do I go to
> change X?" rather than restating what the code says.

---

## 1. What this plugin is

A RisuAI plugin that watches chat messages, asks an LLM to turn prose into
Danbooru-style image prompts, generates images (NovelAI or ComfyUI), and overlays
them on the chat.

It ships as **one JavaScript file** that Risu loads as an ES module.

---

## 2. The one thing you must understand: the frozen UI

The plugin has two halves, and **only one of them is source code in this repo.**

| Half | Source | Size | Can we change it? |
|---|---|---|---|
| **Backend** (this repo's `src/`) | TypeScript | ~12.7k lines, 51 files | Yes — this is our code |
| **UI** (`vendor/inlay-nexus-ui.js`) | *none — upstream Vite build* | 503 KB | **No.** Treat as a binary |

(1.x was 9.2k hand-written lines, 7.1k of them in a single `native-backend.js`
IIFE. 2.0 is slightly longer because types and intent comments are now written
down; the win is that no file exceeds ~950 lines and each has one job.)

The UI was built by a separate upstream project whose source we do not have. It is
pre-patched to talk to us through `globalThis.__INLAY_NATIVE__` instead of HTTP.

**Consequence:** the backend's job is to satisfy a fixed contract. We may rewrite
*how* we answer, never *what* we answer. That contract is
[`docs/UI-CONTRACT.md`](docs/UI-CONTRACT.md) and it is enforced by `npm run parity`.

### Two hard constraints the build enforces

1. **Our code must declare zero top-level names.** Both halves share one module
   scope, and the UI already declares `style, Zt, on, ta, Kt, Jt, sn, gn`. We build
   as an IIFE so collision is structurally impossible.
2. **The final file must stay an ES module.** The UI ends in a top-level `await`.

---

## 3. Directory map

```
inlaynex2.0/
├── REPOMAP.md            ← you are here
├── AGENTS.md             ← rules for making changes
├── vite.config.ts        ← the whole build (~190 lines; replaced a 1,145-line script)
├── vendor/
│   └── inlay-nexus-ui.js ← FROZEN. Never edit
├── prompts/*.txt         ← LLM prompt pack, embedded by vite.config.ts (see §9)
├── reference/            ← the 1.x sources, kept read-only for diffing. Not built
├── docs/
│   ├── UI-CONTRACT.md       ← every route + bridge method the UI depends on
│   ├── SERVICE-CONTRACTS.md ← exported signature of each service module
│   └── OPTIMIZATIONS.md     ← what got faster and how it was measured
├── tools/
│   ├── audit.mjs         ← structural invariants of the built file
│   ├── smoke.mjs         ← boots the built file and drives real requests
│   ├── bench-gallery.mjs ← a cold gallery must list without decoding images
│   ├── check-docs.mjs    ← fails if these docs name a path that has moved
│   ├── build-tests.mjs   ← compiles pure modules to .test-build/ for the unit tests
│   └── parity/           ← old-vs-new behavioural diff (the safety net)
├── tests/*.test.mjs      ← unit tests for pure modules
└── src/                  ← see below
```

`.test-build/` and `.parity/` are generated scratch directories; both are
gitignored. `dist/omninexus.js` *is* committed — it is the file users load.

---

## 4. `src/` layout — layered, no cycles

Dependencies point **downward only**. If you find yourself needing an upward
import, the logic is in the wrong layer.

```
main.ts                     entry: builds the bridge, publishes globals
  │
  ├─ bridge/                globalThis.__INLAY_NATIVE__ + the UI-contract globals
  │
  ├─ api/                   HTTP emulation: declarative route table + auth
  │
  ├─ services/              use cases, one file per noun (settings, jobs, gallery…)
  │
  ├─ domain/                pure business rules (characters, lore, prompts)
  │
  ├─ providers/             outbound I/O (llm, nai, comfy)
  │
  ├─ storage/               persistence (device store, stores, images)
  │
  ├─ config/                defaults, migration, presets
  │
  └─ core/                  types, utils, debug — depends on nothing
```

### Where do I go to change…?

| I want to change… | Go to |
|---|---|
| A default setting value | `src/config/defaults.ts` (regenerated — see the file header) |
| How old settings upgrade | `src/config/schema.ts` |
| Add/rename an API route | `src/api/router.ts` (one table entry) |
| Auth / query-string parsing | `src/api/http.ts` |
| What the tagger LLM is told | `prompts/tagger.txt`, assembled in `src/services/tagger.ts` |
| How a shot becomes an NAI prompt | `src/services/generation.ts` |
| Comic kind / line range / V5 page build | `src/domain/comic/`, `src/services/comic.ts`, `buildComicGenerationForShot` |
| V5/V4 shot routing, keys, coords, speech | `src/domain/nai/` |
| Character name/alias matching | `src/domain/character/identity.ts` |
| Session + global roster merging | `src/domain/character/roster.ts` |
| Which lorebook entries get injected | `src/domain/lore/assemble.ts` |
| NovelAI request payload | `src/providers/nai/payload.ts` |
| NovelAI HTTP / ZIP response handling | `src/providers/nai/http.ts` |
| Add an LLM provider | `src/providers/llm/providers.ts` |
| Request/response reshaping per provider | `src/providers/llm/transform.ts` |
| How rows are saved | `src/storage/stores.ts` |
| Image caching / data URLs | `src/storage/image-urls.ts` |
| The job pipeline order | `src/services/jobs.ts` |
| How many old jobs to keep | `src/domain/jobs/retention.ts` (`JOB_RETENTION_LIMIT`) |
| Manual roster fill (페소에서 / 가져오기) | `src/services/char-import.ts` — lore uses `collectAssetNaiTags` + `buildCharacterLooksMessages`; no-meta → `collectBestLookAssets` + autotag then lore text; save via `mergeRosterFromTagged` |
| Whether a message is already busy | `src/services/job-locks.ts` — shared by `jobs` and `cards`; do not re-derive it |
| Gallery / explorer queries | `src/services/gallery.ts` |
| Anything the UI reads off `globalThis` | `src/bridge/ui-globals.ts` |
| 플로팅 뷰어 로딩 / 읽기 위치 / 접힘 / 투명도 | `tools/vendor-patches/float-viewer.js`, `float-viewer-input.js`, `float-viewer-position.js`, `float-viewer-render.js`, `float-viewer-style.js`, `float-viewer-drag.js` — `runtime-rebuild.mjs`에서 검증 후 UI 클로저에 삽입 |
| 호스트 왕복·리스너·세션 판정 (최종 번들에 마지막으로 적용) | `tools/vendor-patches/host-traffic.mjs` — 검사는 빌드 뒤 `tools/check-host-traffic.mjs` (배포 코드를 그대로 잘라 실행) |
| BGM·효과음 (메뉴 "BGM·효과음", 모듈 ⚛️ omni bgm / ⚛️ omni 효과음) | 순수 로직 `src/domain/sound/` (태그·매칭·오디오 판별·모듈), 데이터 `src/storage/sound-store.ts` (`omnisound.data`), 모듈·에셋 `src/storage/sound-module.ts`, 재생 `src/providers/sound/player.ts`, ElevenLabs 효과음·BGM 생성 `src/providers/sound/elevenlabs.ts`, JEV·LLM 효과음 고르기 `src/providers/sound/choose.ts`, 실행 `src/services/sound-runtime.ts`, 화면 `src/sound-ui/` (TTS 루트를 공유, 메뉴 페이지는 `page.ts`). 채팅 ♪/▶ 버튼과 TTS 목록·이어 읽기의 BGM·효과음 줄은 `src/tts-ui/host-chat.ts` + `TtsSoundCuePlayer`(`src/services/tts-runtime.ts`, 소리 런타임이 등록) |
| 스트리밍 태그 생성 (생성 옵션 → "Risu 메인 모델 메시지 스트리밍 중에 태그 생성", 모듈 ⚛️ omni 스트리밍태그) | 블록 해석 `src/domain/prompt/inline-shots.ts` (패턴은 `inline-shot-pattern.ts`, L줄 계산은 `message-body.ts`가 블록을 가림), 규칙·채팅 상태·`beforeRequest` `src/services/inline-tagging.ts` (규칙 본문은 `tagger.ts` `taggerRules`), 모듈 `src/storage/inline-tag-module.ts` + 표시 정규식 `src/domain/inray-display.ts`, 스트리밍 감지 `tools/vendor-patches/stream-inline-runtime.js`, 작업은 줄 단위 묶음 경로(`jobs.ts` `inline_tagged`), 박제는 같은 두 번(응답 완료 / 전부 끝난 뒤)이지만 본문 비교 없이 메시지 id로 찾아 한 장씩 `src/services/inline-bake.ts` (`chat-bake.ts` `rewriteMessageById`: 저장이 겹치면 다시 읽음), 우리 태거 요청 식별 `src/providers/llm/own-requests.ts`. 「이미지 바로 생성」 off: 대기 칸 박제·탭 생성 `src/services/inline-waits.ts` (`/v1/inline-tags/park`, `/v1/inline-tags/generate`), 탭 감시 `src/image-ui/wait-taps.ts`, 분홍 칸 표시 `waitDisplayRegexScript`. 한 답변 안 블록끼리 옷 상태·코스튬·장소 이어받기(메모리, 답변 끝에 세션 노트 한 번) `src/services/stream-continuity.ts` |
| The bridge object itself (`fetch`, `ready`) | `src/bridge/native.ts` |
| Shot-tag 도화지 (갤러리 「샷 태그 수정」) | `src/tag-studio/` — peel/assemble in `peel.ts`/`model.ts`, overlay in `mount.ts` |
| 설정창 크롬 / TTS 탭 afterPaint | `src/settings-ux/` — CSS inject + `__INLAY_SETTINGS_UX__.afterPaint` |
| 대시보드 설정 프리셋 | `src/services/settings-presets.ts`, `src/domain/settings-preset.ts`, `src/settings-ux/settings-presets.ts` — 일반 설정 + 노트 4종, 기존 스타일/연결 유지 |
| 박제 후 읽기 | `src/services/tts.ts` (`card.tts_*`) |
| TTS 채팅 재생 버튼 (OmniTTS 모듈) | `src/domain/tts/module.ts` — display regexes only, all ordered after every other module; never edit the reply before other modules see it. Controls are zero-width so wrapping never changes |
| TTS 버튼 ↔ 원문 줄 연결 | `src/domain/tts/anchors.ts` (rendered line text → parsed segment), `src/tts-ui/host-chat.ts` (bind, dead/narration/playing attributes) |
| TTS 설정 도움말 | `src/tts-ui/help.ts` — keyed by control id, served through `previewHelp` |
| 캐릭터 LLM 명령수정 / 헤더 참고 | `src/char-command/` — `mount.ts`, `src/domain/character/command-edit.ts` |
| 이 세션 작가 노트 | `src/services/session-author-note.ts`, tagger inject in `src/services/tagger.ts` |
| Reaching the Risu host API | `src/core/host.ts` — the only place that touches `globalThis.risuai` |

---

## 5. Request lifecycle (the path every UI action takes)

```
UI calls K("/v1/gallery?session_id=…")        vendor/inlay-nexus-ui.js
  → globalThis.__INLAY_NATIVE__.fetch(...)    src/bridge/native.ts
  → await ready()                             src/bridge/native.ts   (once, memoised)
  → route lookup                              src/api/router.ts      (table, not if-chain)
  → auth check                                src/api/http.ts
  → handler                                   src/services/*.ts
  → data                                      src/storage/stores.ts
  → JSON back to the UI
```

The router is a **table**, so adding a route is one entry and never touches
dispatch logic. The 1.x version was a 286-line `if/else` chain.

---

## 6. Storage model

Risu gives us one async key/value store (`getLocalPluginStorage()`, IndexedDB).
On top of it we keep five logical row stores plus per-image blobs.

| Key | Holds |
|---|---|
| `onx_native_settings` | the settings object |
| `onx_nxstore_meta` | prompts, toggles, favourites, reference/vibe metadata |
| `onx_nxcrefd_vibe_<hash>` | character reference encoded-feature cache (existing key retained); new writes leave small index rows in `onx_nxstore_meta`. Old inline caches remain readable without boot-time migration or cleanup. |
| `onx_nxstore_cards` | generated image cards |
| `onx_nxstore_characters` | roster rows, keyed `"<scope>\t<id>"` |
| `onx_nxstore_jobs` | job rows (newest 3 + any still running; see `src/domain/jobs/retention.ts`) |
| `onx_nxstore_images` | image metadata (**not** bytes); may include `location.asset_path`. No `assistant_preview` — newest 20 card metas keep that for stream rematch (`src/domain/gallery/preview-retention.ts`) |
| `onx_nximg_<id>` | leftover 1.x / old-fallback bytes, base64 (read-only; new shots never write this) |
| `onx_session_author_note_<sessionId>` | per-chat author's note (`{prefix,suffix,preset_id}`; not the global `author_note` prompt) |
| `onx_session_author_note_presets` | reusable session-note phrases |
| `onx_author_note_presets` | saved texts for the main tagger author's note (`{items[{id,name,text}]}`); shipped examples are not stored |
| `onx_pending_shot_assets` | shots saved while an image job ran but not yet registered in the character (`[{target:{id,index},rows:[{name,path}]}]`); registered with the bake, or at the next start |
| `onx_char_command_presets` | LLM 명령수정 phrase presets (legacy device row; live list is `card.command_presets`) |
| `onx_settings_presets` | Dashboard settings presets, hidden examples and last applied id; no style collections or credentials. |
| `omnitts.data` | TTS settings, voice library, folders and **global** TTS characters (`src/storage/tts-store.ts`). |
| `omnisound.data` | BGM·효과음 settings, lists, glossary (`src/storage/sound-store.ts`). |
| `omniinline.waits` | Streaming-tag waiting slots: older slots only (new ones are `[[inxwN]]` blocks in the message itself): the shot each pink `[[@inraywait::id…]]` will draw, newest 300 (`src/storage/inline-wait-store.ts`). |
| `omnisound.bgm.index`, `omnisound.bgm.<hash>` | **Device-local** (`getLocalPluginStorage`, never in the save file): BGM link tracks kept for the next play, base64, least recently played dropped past `bgmCacheMb`. Read through the index only, never by listing the store (`src/storage/bgm-cache.ts`). |
| bot lorebook entry `omni.nexus.tts` | A bot's own TTS characters (`src/storage/tts-roster.ts`): disabled, empty key, never injected; same write queue as `omni.nexus.data.global`. 1.2.0 per-chat rows migrate here when the bot is opened. |

**Keys are frozen.** Renaming one silently orphans every existing user's data.
The same is true of `//@name omni-nexus` in `vite.config.ts` — Risu
namespaces plugin storage by it.

See `docs/OPTIMIZATIONS.md` for how writes were reduced.

---

## 7. How to verify a change

Run in this order; each is fast.

```bash
npm run typecheck   # tsc --noEmit
npm run unit        # 100 unit tests over the pure modules
npm run build       # produces dist/omninexus.js
npm run audit       # structural invariants of the built file + doc link check
npm run smoke       # boots the built file and drives real requests through it
npm run bench       # a 40-image gallery must list without decoding any image
npm run parity      # old vs new behavioural diff  ← the important one
```

`npm test` runs all seven in that order.

The three bundle-level checks cover different failure modes, which is why all
three exist: `audit` reads the built file as **text**, `smoke` **executes** it,
and `parity` exercises the backend **logic** without the bundle at all. The
missing prompt pack (REPOMAP §8) was invisible to `parity` and to the old
`audit`, which is what prompted `smoke`.

`npm run bench` guards the one property parity structurally cannot see. Parity
diffs **responses**, so work done to produce a response is free as far as it is
concerned — a listing that base64-decodes all 500 images in a gallery passes it
with identical bytes. It is easy to reintroduce, too: a card's placement metadata
and its pixels live in the same row, so any metadata read routed through
`idbGet('images', …)` hydrates the image. `tools/bench-gallery.mjs` seeds 40
images and asserts a cold listing returns no `image_url` at all (proving nothing
encoded synchronously) while every `png_bytes` is still correct (proving the
index path works). Use `imageLocation()` / `imageMeta()`, never `idbGet`, when you
only want metadata.

The unit tests are plain `.mjs`, so `npm run unit` first runs
`tools/build-tests.mjs` to compile the modules under test into `.test-build/`.
They are the 1.x test suite, unmodified apart from import paths — passing them
against the TypeScript rewrite is the evidence that each port is faithful.

**`npm run parity` is the safety net.** It boots the 1.x backend and the 2.0
backend against one deterministic mock Risu host, replays a 118-step scenario over
the entire API surface, and diffs the normalised results. A clean run means no
observable behaviour changed. If you add a feature, add a step to
`tools/parity/scenario.mjs` — that file *is* the feature checklist.

---

## 8. The prompt pack — a trap worth knowing about

The LLM prompts live in `prompts/*.txt` and are **not** imported by any module.
`vite.config.ts` reads them at build time and emits

```js
globalThis.__INLAY_NATIVE_PROMPTS__ = { tagger: "…", format: "…", … };
```

ahead of our IIFE. At runtime `src/config/prompts.ts` looks up each prompt in
three places, in order: that global, a per-request override, then the compiled-in
value in `src/config/prompt-fallbacks.json`.

**Those fallbacks are one-line stubs**, not the real prompts. So a build that
forgets to embed the pack still loads, still generates, and produces garbage —
the tagger prompt silently shrinks from 9,504 characters to 92. Nothing about it
looks broken.

Two guards exist because of this:

- **Adding a prompt file is not enough.** It must also be listed in
  `PROMPT_KEYS` in `vite.config.ts`; `tests/build-layout.test.mjs` fails if you
  forget.
- `tools/audit.mjs` verifies every embedded prompt matches both the file on disk
  and 1.x, **byte for byte** — line endings included, since four of the files
  carry CRLF. That is about keeping the built artifact diffable against 1.x, not
  about the request payload: `cleanText` normalises CRLF before a prompt is ever
  used. `.gitattributes` pins the endings so a fresh clone still matches.
- `tools/smoke.mjs` boots the built bundle with no externally supplied prompts
  and asks it for the tagger over the real route, so a stub cannot pass.

The parity harness cannot catch any of this — it drives the backend module
directly, never loads the built bundle, and installs a prompt pack of its own.

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **card** | one generated image plus its prompt/placement metadata |
| **shot** | one planned image inside a scene, as returned by the tagger LLM |
| **roster** | the characters known for a chat (session rows + globals merged) |
| **scope** | `"__global__"` or a session id — which bucket a character row lives in |
| **session id** | Risu chat identity; `unified_session_id` spans linked chats |
| **content hash** | fingerprint of a message, used to re-attach cards after edits |
| **folder** | explorer grouping, keyed `"<character_id>\|<chat_id>"` |
| **vibe transfer** | NovelAI style-reference encoding |
| **anlas** | NovelAI credit balance |
