# UI CONTRACT

Everything the frozen UI (`vendor/inlay-nexus-ui.js`) requires from the backend.
The asserted comic-options patch adds `nx-comic-natural-supplement`, bound to
`card.comic_natural_supplement` (boolean, default false). When enabled, every
comic cut's `natural` description follows its base tags in the generated layout.
The UI cannot be rebuilt, so this contract is **fixed**. `npm run parity` enforces it.

The asserted inspect patch uses `GET /v1/shots/asset?name=...` to read file
base64 plus `{ids, names}`. `ids` preserves filename cast order; `names` maps
cast ids to current roster names. Character assets take precedence over the
legacy gallery module. Missing names/files and unreadable files throw explicit
`asset_name_required` (400), `asset_not_found` (404), or `asset_read_failed`
(422) errors. A roster read failure returns pixels with `warning` so it cannot
erase an otherwise readable image. A 404 with `asset_not_found` therefore does
not mean the route is missing or the installed plugin is old.

`GET /v1/shots/cast?card_id=...` supplies the asset name when SafeDOM cannot
read it off the chat wrapper. Inspect opens the frozen loading sheet before
awaiting even that lookup. `GET /v1/shots/asset?cast=0&name=...` skips roster
reads; `POST /v1/shots/resolve-cast` resolves names independently; `{ids, details:true}` returns `{characters:[{cast_id,id,scope,name}]}` so global cast chips retain their editor scope. Each updates
the open sheet as it arrives. File base64 takes precedence over card thumbnails.
The existing sheet/actions are reused, and up to five recent files (8 MiB of base64
text each) can paint immediately on reopen while names refresh. Same-file reads in
flight are joined. Close invalidates pending updates so they cannot reopen it.

---

## 1. `globalThis.__INLAY_NATIVE__`

The UI's fetch wrapper is `K(path, init, timeoutMs)`; it throws
`"Inlay Nexus backend unavailable"` if `.fetch` is missing.

| Member | Signature | Notes |
|---|---|---|
| `writeMetrics` | `() => Record<string,{calls,failures,totalMs}>` | Memory-only write counters, no payloads |
| `hydrateSettingsPreviews` | `(tab: string) => Promise<boolean>` | Lazy generation/style preview hydration; never required by ready |
| `ready` | `() => Promise<boolean>` | Awaited before every request |
| `flushSettings` | `() => Promise<void>` | Drains the latest settings snapshot to storage and verifies it. Settings close runs this in the background; failure must remain visible and retryable. |
| `fetch` | `(path, {method, body}, timeoutMs) => Promise<any>` | `body` is a **plain object**, not a JSON string. Resolves with the parsed response; throws on error with `.status`/`.data` |
| `resolveImageUrl` | `(cardOrId) => string` | Synchronous cache hit, else `""` |
| `ensureImageUrl` | `(id) => Promise<string>` | Loads and caches |
| `subscribeImageUrl` | `(ids: string[], cb: (id, url) => void) => () => void` | Fires per id as it becomes displayable; replays ids already cached. Caller **must** run the returned unsubscribe |
| `warmImages` | `(ids: string[]) => Promise<string[]>` | Prefetch. Queues onto the one shared encoder rather than encoding in parallel itself, so `prioritizeWarmFocus` / `pinImageUrls` genuinely decide who goes first. Resolves once every id has a URL **or has been given up on** — a missing image and an id evicted by `retainImageUrls` both settle. `ensureImageUrl` for an id already encoding joins that encode rather than starting a second one |
| `pinImageUrls` | `(ids: string[]) => void` | Pin sticky-window ids against data-URL LRU eviction; prioritizes their warm queue. Only the first `BLOB_URL_PIN_CAP` (24) ids are protected — callers pass focus-first, and `nearbyMessageImageIds` never returns more than that |
| `warmProgress` | `() => { pending, active, done, total, pct, busy }` | Full background warm wave (viewer status) |
| `warmFocusProgress` | `() => { pending, active, done, total, pct, busy }` | Selection-focus warm only — mint progress toast |
| `prioritizeWarmFocus` | `(ids: string[]) => void` | Move these ids to the front of the encode queue and scope `warmFocusProgress` to them. Priority only — nothing else is parked |
| `clearWarmFocus` | `() => void` | End the selection-scoped progress readout |
| `refPreviewUrl` | `() => string` | Reference-image preview `src` |
| `vibePreviewUrl` | `() => string` | Vibe-image preview `src` |
| `VERSION` | `string` | Not read by the UI; kept for diagnostics |
| `debug` / `clearDebug` | `() => any` | Not read by the UI |
| `openTagStudio` | `(card) => Promise<void>` | Shot-tag 도화지. Overlay only — `openCardTagEdit` owns `showContainer` / `hideContainer` like the old modal |
| `closeTagStudio` | `() => void` | Dismiss the overlay. `closeCardTagEdit` calls this so the container pair still closes |
| `openCharacterCommandEdit` | `(opts) => void` | Additive. Character-form LLM 명령수정 overlay |
| `openImagePeek` | `(src) => void` | Additive. Centered image overlay; does not close parent modals |

> **Host HTML image URLs must be `data:image/...`.** SafeDOM sanitizes `img.src`.
> The fullscreen inspector instead clones the existing host `img` through
> `SafeElement.cloneNode(false)`, preserving Risu's resolved source without
> reading image files, encoding base64, or creating Blob URLs. Both the image
> and controls live in the host document; settings' iframe is never opened.
> Close removes/releases only the clone. A missing host image shows an error.
> Cast names resolve separately into a reserved two-row, 72px chip area.
> The image-file route remains available to other callers.
>
> **Listing rows carry no `image_url`.** `/v1/gallery`, `/v1/gallery/explore`
> and job-result cards omit the key (2.5.33). The UI resolves a display URL from
> the sync cache (`resolveImageUrl`) at paint time and warms only its visible
> window; the cache is the single owner of every data URL. Copying one onto a
> row (`card.image_url = …`) is a build-time error because `t.gallery` rows live
> for the session, so the copy outlived its eviction and the 64MB budget bounded
> nothing. Single-card responses (`/v1/cards/:id`, reroll, studio-commit) still
> carry `image_url` for the modal that asked.
>
> Explorer thumbs: the grid paints from `resolveImageUrl` and fills in via
> `warmImages` / `onWarmProgress`. While the explorer panel is open, warm progress must still
> reapply `src` on `.explorer-card img` (build patch); otherwise freshly generated
> cards stay on the broken-image icon until a full panel remount.
>
> Every surface shares one encode budget, so an explorer folder full of cold
> thumbs and the selected bubble's shots compete for the same slots. That is why
> the inline paint calls `prioritizeWarmFocus` — it is the only thing that decides
> which of them the user sees first.
>
> Style presets may carry optional `cfg_scale` / `cfg_rescale` (empty → NAI
> model defaults). Per-preset vibe is a device-local upload like NAI vibe
> (`POST /v1/nai/vibe` with `preset_id`) stores the PNG only — no encode on
> upload. `encode-vibe` runs at generate time when that preset is used on a
> V4/V3 model, with `api_keys_v4` (then legacy `api_key`). JSON export does
> not embed vibe bytes. Per-preset **look** shots (`look_hash`) are picker
> previews in the char-ref module; they are never sent as vibe/director.

## 2. Other globals the UI reads

Supplied by `src/bridge/ui-globals.ts`. The UI degrades gracefully if a method is
missing, which historically hid bugs — so we publish the full surface.

| Global | Purpose |
|---|---|
| `__INLAY_VIEWER_CORE__` | overlay/pin geometry, gallery ordering, DOM↔API message matching; sticky always-image size via `resolveStickyThumbPct` / `stickyThumbBoxFromPct` (hide = 0% — 상시 off, tap-접기, or settings/shot/char editor; close restores from 접기 flag) + `fitBoxInside` against NAI w×h; overlay toggle OFF keeps sync alive and parks via 0% thumb + off-screen pin (avoids hideStickyMarker thrash); with 말풍선 삽화 ON, `stickySegmentForInlineChat` picks the shot nearest the pointer for sticky activation; sticky thumb HTML/shell use transparent backgrounds (no opaque letterbox bars); `claimStickyMarkerByCardId` reuses a still-mounted pin on partial card-set swaps so sticky pins do not duplicate |
| `__INLAY_LLM__` | provider list, endpoint defaults, model placeholders |
| `__INLAY_LORE_EXTRA__` | `lb-xnai.lb.extra` lorebook trimming |
| `__INLAY_LORE_FILTER__` | character-lore whitelist helpers (`filterLoreEntriesBySelected`, catalog) |
| `__INLAY_STYLE_PRESETS__` | style-preset parse/export: card.json `character_book` + Risu `lorebook_export` (`type: risu`) |
| `__INLAY_EXPLORER__` | explorer multi-select state machine |

The UI also sets `globalThis.INLAY_NEXUS_RUNTIME` to its own state object, and
requires the host `globalThis.risuai`.

## 3. Routes

`GET` unless noted. Auth: `Authorization: Bearer <token>` or `X-Inlay-Nexus-Token`,
skipped for health/debug.

### Health
| Route | Response |
|---|---|
| `/v1/health`, `/healthz`, `/readyz` | `{ health: { version, storage, … } }` |

### Settings
| Route | Body → Response |
|---|---|
| `/v1/settings` | `{ settings }` |
| `PUT /v1/settings` | partial `{card?, llm?, llm_roles?, nai?}` → `{ settings }` |
| `POST /v1/settings/update` | alias of the above |
| `/v1/settings/export` | `{ json }` — drops `api_key`/`auth_token`/`password`/`secret`, but **not** `service_account_json`; see the note in `src/config/schema.ts`. Embeds the prompts pack as top-level `prompts: { [key]: text }` (same shape as `GET /v1/prompts/export`). |
| `POST /v1/settings/import` | `{ json }` — a top-level `prompts` map is restored first (known pack keys only), then the settings merge runs without it, so prompt text never enters the live config |
| `POST /v1/settings/reset` | `{}` → `{ settings }`; applies the recommended pack; **keeps API keys, window pin, card presets**; then `POST /v1/prompts/reset-defaults` `{ keep_author_note: true }` |

The UI guards writes with a `settingsWriteGen` counter and merges pending patches,
so out-of-order responses are discarded client-side. The backend just answers.

### Prompts
The editor list excludes retired `char_looks`, `autotag`, `asset_tags_inject` and `asset_author_note`. Existing stored values remain available through per-key reads and full-pack export; they are not injected into generation requests.

`/v1/prompts` → `{ prompts: [{key, text}] }` · `/v1/prompts/:key` ·
`PUT /v1/prompts/:key` `{text}` · `POST /v1/prompts/:key/reset` ·
`GET /v1/prompts/export` → `{ version, prompts: { [key]: text } }` ·
`POST /v1/prompts/import` `{ json | prompts }` ·
`POST /v1/prompts/reset-defaults` `{ keep_author_note?: true }` (default keeps
`author_note`, `asset_author_note`, `global_author_note`; resets every other pack key).

The frozen UI prompts tab has pack-level toolbar buttons (reset defaults except
author note, export/import all JSON) and per-prompt JSON export/import beside
save/reset — asserted build patches in `vite.config.ts`. Reset (single and pack)
asks `globalThis.confirm` first.

`card.natural_base` is a string mode: `off` | `short` | `detailed` | `supplement`
(legacy booleans migrate in `schema.ts`). The dashboard control is a `<select>`
patched in at build time (was a checkbox). Beside it: `card.v5_natural_lang`
(`en` | `ja`) for V5 shots only, and `card.nai_use_coords` (default on).
Coords apply only with 2+ complete 0–1 pairs; if any two characters share a
spot, `use_coords` stays off for that shot.
Card settings → 생성 옵션 puts eight toggles in one grid: coords,
`card.nai5_first` (LLM한테 NAI V4, V5 선택권주기; simple→V4, dynamic→V5),
`card.nai5_only` (무조건 NAI V5한테만 요청하기; wins over first + model tab),
`card.nai5_speech` (NAI5 대사삽입), `card.auto_aspect` (자동 비율 조절),
solo, costume, no humans. Off `nai5_first` uses the model-tab model for
every shot. Dashboard save keeps the stored flags when those checkboxes
are absent.
Tag studio (샷 태그 수정) reads model / size / sampler from the image NAI
metadata (`GET /v1/cards/:id/nai-prompt`). Dropping a PNG/WebP onto the
canvas uses `POST /v1/cards/nai-from-image` `{ image_data_url }` (same
payload, no card write). Unmatched char names stay C1/C2/C3. V4.5 / V5 and 가로·세로·정사각
override that scene on generate. Metadata with a non-0.5 character center
opens 좌표보기. AI 좌표 sends `use_coords: false`. `card.studio_seed_lock`
(default off) keeps the 고정 켬 toggle across studio opens.
`card.studio_folds` is `{ [sectionId]: true }` for collapsed tag-studio
sections (`preset`, `post`, `gset`, `llm`, `llmPeek`, `ap`, `po`, `costume`,
`xy`, `gs`). Missing keys stay open.

Settings nav tab `comic_gen` (만화 생성, next to 생성 옵션) is
`card.comic_gen` `off` | `on` (default `off`). Off leaves first-tagger + NAI
identical to today. On lets the tagger emit `kind: comic` with `line` (start /
pin, same as illustration) and `comic_line_end` (inclusive prose end). Slots
are people/text boxes, not panels. Comic generation ignores
`card.character_max` and keeps up to 6 slots (NAI caption ceiling).
`card.comic_llm_batch` is `once` | `per_shot` | `with_main`
(default `once`). All three apply slot `wear_state` the same way as
illustration (`clothed`/`torn`/`topless`/`bottomless`/`nude`/`completely`;
omit inherits). `with_main` asks the first tagger for nested `comic_page`
(same layout JSON: koma/location/coords/layout/slots). Missing pages still call the
comic LLM. `once` / `per_shot` keep a separate comic LLM and do not ask the
main tagger for panel layout. `card.comic_schedule` is `overlap` | `wait_taggers` (default
`overlap`). `card.comic_gen_ratio` is 0–100 (default `50`): share of this
message's shots that may be `kind: comic`. Extra comic shots become
illustration. `card.comic_max_pages` is kept for old saves (0 pages →
ratio 0). `card.comic_coords` is `ai_choice` | `llm` | `position` (default
`llm`). `card.comic_aspect` is `llm` | `landscape` | `portrait` | `square`
(default `llm`): comic shots use the tagger canvas, or lock 1216×832 /
832×1216 / 1024×1024. Spinner and NAI size follow that lock even when
`auto_aspect` is off. Illustration shots still use the gen-option auto-aspect
toggle: off means NAI tab W×H for both the spinner (`pending_inline` width/height)
and the canvas; on means the tagger aspect trio. Empty comic NAI overrides (`comic_steps`, `comic_sampler`,
`comic_cfg_scale`, `comic_cfg_rescale`) fall back to the existing NAI tab +
style preset. `card.comic_prompt_prefix` / `comic_prompt_suffix` wrap the
comic main like the gen-option fixed prompts. Legacy `comic_prompt` copies
into prefix when prefix is absent; `comic_uc` is no longer shown.
`card.comic_author_note` is tone/world for the comic LLM, not an artist
stack. Comic pages always use V5. Dashboard/tab save keeps stored comic
fields when those controls are absent (`Ct()` + `assertOnce`).

`card.persist_chat_images` (boolean, default `true`) is the dashboard
toggle **생성완료 시 채팅에 박제**. Omni Nexus finishes a job by baking
shots into the chat. `card.inline_chat_images` (default `true`) is only
the mid-job spinner/photo stack, not a stay-on-select overlay. `card.persist_chat_images_folded`
(boolean, default `false`) is **박제이미지 접혀있는게 기본** — the display
module checkbox starts `checked` (top peek, animated clip — the image is not hidden). When persist is on, finished shots stay inline during the job and are written
into the saved Risu message **once the job is done**, at the same `line` / `inline_chat_text_side`
as inline inject, using `[[@inray::<cardId>::<inxshot_name>]]` (gallery
bytes, not a second asset). The `inlay-inray-display` module (`editdisplay`)
turns the token into a centered `<img src="{{raw::<inxshot_name>}}">`
(Risu official path CBS) plus a hover fullscreen chip that
opens the same inspect sheet as triple-tap / hold. After writing tokens
the plugin bounces the gallery module on `enabledModules` (or a host
refresh helper) so CBS sees the new name without a manual asset-list
reload — bounce and `setChatToIndex` share one scroll-hold session that pins
`scrollTop` every frame across the remount, reserves bake-box aspect from the
card size, and waits for image layout. Tag (`force`)
strips those tokens first. The refresh chip no-ops when the bubble already has a bake wrap or
`[[@inray]]` token. Otherwise it drops plugin inline frames only. A persist reroll rewrites
`[[@inray::prev::inxshot_…]]` to the new card id / asset name and does not
overlay an inline photo on the bake wrap. Ready inline photos are skipped only after that
card's bake token (or display wrapper) is already on the bubble; pending
spinners still are. Message `content_hash` (`ye`) hashes `proseForHash`
(tokens stripped). Bake remount no longer holds chat scroll
(`__INLAY_SCROLL_HOLD__` is a pass-through).

Dashboard also has `card.toast_anchor` (`tl` | `bl` | `tr` | `br` | `tc`,
default `tc`) for progress / selection / host / attach toasts, and
`card.inline_chat_text_side` (`before` | `after`, default `before`) puts the
inline spinner/photo before the matched line text or after it. Already-mounted
frames stay put; the next inject or refresh uses the new side.
`card.inline_chat_dom_radius` is unused for neighbour stamping. Selecting a
message paints chips/fans only — it does not stamp a spinner or overlay
photo. The spinner/photo stack is injected when a tag/generate job has
`pending_inline` for that bubble (or an explicit restamp). After the job
completes, persist bakes `[[@inray]]` tokens and the overlay is not
re-attached on later clicks. Message-body chips are off; tag/regen sit on
the baked image overlay.
`card.scroll_hold` may still exist in saved settings but is not read.
Newest-at-bottom leaves Risu autoscroll alone.
Scroll-end sticky activate is one scheduler (`nxScheduleStickyScrollSnap`);
sticky thumb innerHTML is `data:image` only (`composeStickyV2ThumbHtml` — blob
becomes a transparent placeholder, not `src=""`).
Canonical inline frames are append-only for the lifetime of a Risu message DOM:
the spinner keeps the layout height. A photo swap decodes into a hidden A/B
cell, then drops the unused sibling. SafeDOM cannot mutate an image `src`, so a
hidden cell receives its child through `setInnerHTML`. Runtime metadata is
mirrored onto readable `x-inlay-inline-*` attributes. Re-clicking an intact
selected message is a no-op. Leaving the photo window removes that bubble's
A/B cell nodes; leaving the spinner window keeps the frame. Kept bubbles
are not restored or reloaded. Reroll / tag-studio save drops that shot's
unused A/B cell and swaps only that wrap.
A tag action alone
removes that bubble's spinner frames and photo cells, then restamps after the
tagger finishes; reroll/regeneration retargets the stable shot slot in place. Frame keys include the API message index as well as
session and content hash, so two identical message texts do not share clears or
image subscriptions. Injection locks use session + API message index without
the mutable content hash, while owner generations serialize both metadata and
photo writes so an older subscription cannot repaint a rerolled frame. Placement
keeps one card per stable shot slot (line is only the fallback when no shot index
exists), so distinct shots may share a paragraph without collapsing. If a legacy
or raced DOM already contains repeated wrappers for one slot, the runtime keeps
the desired card's wrapper and removes only the proven duplicates.
`card.image_press_inspect` (`off` | `hold` | `two` | `three` | `both`, default `hold`)
for enlarge on inline/sticky shots. `two` is a fast double-tap on the same
shot (saved `two` / `double-tap` normalize here). `three` is a fast triple-tap
(`triple` / `triple-tap`). `hold` is a long press. `both` is hold plus double-tap. On plugin boot and the first enter of a chat session,
an attach toast reads `인레이 넥서스 조각 불러오는중..` until chips and shots
land, or 10 seconds, whichever is first. Later message clicks do not raise it.
Dashboard also has `card.nai4_fallback`
and `card.inline_msg_actions` as a 3-way select: `off` (사용안함),
`legacy` (편의성, 오류율 있음 — DIV hosts),
`compat` (호환성 — body tags `p`/`li`/`h*`/`blockquote` as hosts).
Both modes put the top bar before the first child of the content parent
and the bottom bar after the last child (`msgActionBarPlace`), when that
parent is inside the bubble. Neither mode removes mounted inline frames. Saved checkbox `true`
migrates to `compat`. Same neighbor rule as `inline_chat_images`.
Chips still use SafeDOM `H()` (not `insertAdjacentHTML`, not
bubble-root `prepend`). They mount only when the bubble role normalizes
to `char` and the LBDATA-stripped body is at least 20 non-whitespace
characters (`shouldMountMsgActions`). The top bar needs 600
(`msgActionWantedEnds`); the bottom bar still uses 20 and only when the
bubble has two hosts. User / unresolved / short bodies
drop existing bars. Chip rows and shot wraps are skipped when
collecting hosts (`isInlayPaintHost`). Each bubble keeps at most one
top bar and one bottom bar (`x-inlay-msg-end`); overlapping paints
drop extras. If a header vanishes after `legacy`, use
`POST /v1/chat/restore-chrome`. The route stays, but 2.5 dropped its dashboard
button in favour of 2.4 데이터 이전 (see Storage migration).
Chip labels are `태그`, `재생성`, `🟥`, `👨‍👩‍👧‍👦`, `📚`, `🔃`. Kinds stay
`tag` / `regen` / `stop` / `char` / `preset` / `refresh`.
`card.inline_msg_fan` (checkbox, default off) is independent of that
select. When on, a boxed row `⚛️` `🔃` `🟥` `👨‍👩‍👧‍👦` `📚`
(`tag` / `regen` / `stop` / `char` / `preset`, no refresh, no opener)
is appended to `.chattext` on character bubbles that pass
`shouldMountMsgActions`, including unselected ones already in the DOM.
The chip rows stay as they are.
The sixth chip is `refresh` (`🔃`). It abandons inline frames on that DOM
bubble and restamps from linked cards / pending spinners. It does not unlink
hashes and does not start a tagger job.
The character chip POSTs the selected DOM message to
`/v1/characters/triggered` with the same session / unified / source ids as
`/v1/jobs/create`. That route uses the tagger roster (`rosterForSession` +
alias absorb) then `matchCharactersInText`, so the picker lists exactly the
rows the main tagger would inject as "Characters in this message". Duplicate
names carry a 글로벌/채팅 suffix. The chosen row opens the existing character
editor.
On listener rebind, stale action bars from the previous plugin instance are
removed before new listeners attach. The preset chip opens the settings shell
(`At()`) on `style_presets`. `At()` paints after `showContainer`; if `#nx-shell`
never lands after retries, it `hideContainer`s unless another modal owns the iframe.
The close watchdog (`armSettingsCloseWatch`, 4×500ms without `#nx-shell`) is
armed only once the shell has painted — armed earlier it raced the host
roundtrips before `P()` and closed a settings shell that had not opened yet. The
character catalog (`ia()` → `getDatabase`) is not awaited outright: with a
catalog from a previous open the shell paints immediately, otherwise it waits at
most 600ms; a catalog that lands later re-paints once, never over a focused field.
New chat / first open / reply waits 1s then selects the bubble nearest the
current pointer (`provisional`, no auto-gen). A real click in that window
cancels the timer. Listener binding also requests an immediate repaint on an
independent timer, leaving the boot timer intact; if required messages/settings
are not ready, it schedules one delayed bind retry.
`card.preset_from_image_filter` (boolean, default `true`) keeps artist/quality tags when loading a style preset from an image; off dumps the meta main but still strips 1girl/1boy/solo so the person-tag injector stays in charge.
Style presets may set `steps`, `sampler`, `scheduler`, `model_family` (`v4`|`v5`).
Empty `sampler` uses the Models-tab sampler for that family. The preset
sampler list matches Models (Euler Ancestral … DPM++ SDE).
`card.secondary_preset_id` is the green 2nd-priority preset.
`card.command_presets` is `{id, name, cmd, cmd_post?}[]` for the shot-studio LLM command bar (default `[]`).
`GET /v1/nai/quota` returns `{ keys: [{ family, suffix, ok, fixed, purchased, total, opus,
v5_usage?, extra?, error? }] }`. Same token on V5 and V4 is one row with
`family` `v5/v4`. `v5_usage.pct` is NovelAI `usage.percent` when present
(can exceed 100); otherwise remaining/max. `usage.percent` is not also in
`extra`. `v5_usage` / `extra` are omitted when empty.
Anlas comes from `GET https://image.novelai.net/user/subscription`
(`trainingStepsLeft`). Optional `GET …/user/data` (or `…/user/priority` if data
fails) fills V5 usage from `maxPriorityActions`. The old `api.novelai.net`
user host returns HTTP 400 for third-party callers (July 2026 move).
`nai.api_keys_v5` / `nai.api_keys_v4` are extra tokens (legacy `api_key` still works).
`nai.sampler_v5` / `nai.sampler_v4` and `nai.steps_v5` / `nai.steps_v4` are
per-family sampler + steps (Models NAI5/NAI4 panes). Legacy `sampler` /
`steps` stay as the active-tab mirror and migrate into both families when
the per-family keys are missing. Sampler UI is labeled 샘플러 and only
offers Euler Ancestral, Euler, DPM++ 2S Ancestral, DPM++ 2M SDE, DPM++ 2M,
DPM++ SDE. Style-preset `steps` / `sampler` / `scheduler` override when set.

`card.asset_nai_tags` is a string mode: `off` | `inline` | `prepass`
(legacy `true` / `prepass_vision` → `prepass`, `false` → `off`). Card
settings places a `<select>` under the solo/costume row (asserted vendor
patch); dashboard checkbox was removed. `prepass` uses a slim looks LLM
when the asset has NovelAI meta. No meta → autotag LLM + lore as
reference (pixels win).
`card.person_tag_weight` is `0`–`5` (default `3`): NAI emphasis on Inlay
person-count tags (`0` = plain `1girl, 1boy`; `N` = `N::1girl, 1boy::`). Card
settings packs Include Max, person_tag_weight, person_tag_mode, lore_extra, and
natural_base in one auto-fit row (asserted vendor patch).

`card.person_tag_solo` (boolean, default `false`): when the shot has exactly one
character, put `solo` instead of `1girl`/`1boy` (still emphasized by weight).
Also applies when `person_tag_mode` is `off`. UI replaces the unused Preprocessing
checkbox (asserted vendor patch); `card.preprocessing` remains a silent dummy.

`card.costume` (boolean, default `false`): when on, the main tagger receives each
character's `costumes[]` catalog (name[index], note, short attire). A character
+ wardrobe pair (`new_costumes`, `new_characters[].costumes`, or a shot
`costume` object / name+attire) is registered and worn on shots that omit a
pick; an explicit `characters[].costume` still wins. When off, generation still
resolves missing picks to the roster current costume.
Asset `char_looks` always may populate `costumes[]` regardless of this toggle.
Card-settings checkbox sits in a `checks-grid` of `toggle-row`s with
person_tag_solo (same UX as dashboard toggles). Character tab and chip edit
popup use a costume name+arrow combobox (no field labels; placeholder only).

`card.focus_character` is `off` | `female` | `male` | `auto` (default `off`).
Card settings shows a row under 에셋 NAI 태그 (asserted vendor patch):
`focus_character` select, `card.focus_weight` (`0`–`5`, one decimal, default `2`), and
`card.focus_prompt` (`default` | `strong` | `always` | `manual`, default
`default`). When not `off`, the tagger may set optional shot `focus` (one or
more of `1`…`character_max` / `charN`, e.g. `[1,2]`) unless prompt mode is
`manual`. Generation appends out of frame to non-focus captions: weight `2`–`5`
→ `N::out of frame::`, weight `0`–`1` → bare `out of frame`. Prompt modes:
`default` optional, `strong` prefer often, `always` required every shot,
`manual` skips LLM focus and applies out of frame by gender when mode is
female/male (non-matching cast). Empty/invalid focus → no effect (LLM modes).
Shot `focus` is stored on card meta so nai reroll / regen re-applies out of
frame the same way as other shot fields.

`card.char_ref_mode` is `off` | `vibe` | `image` (default `off`); with
`char_ref_strength` / `char_ref_fidelity` in `0.01`–`1` (defaults `0.6` / `1`).
When mode is `image`, `char_ref_image_type` is `character` | `style` |
`character&style` (default `character&style`).
`off` is labeled `안함` and is a hard off: no per-character reference is sent.
Dashboard controls sit beside 이미지 모서리 (asserted vendor patch). Per-character
bytes live in a Risu module (`inlay.char_ref`, asset names `inxref_<hash>.webp`)
via `POST /v1/characters/ref`. Uploads are resized (max width 400, aspect kept)
and stored as webp quality 0.8 when the host can encode it; otherwise PNG or the
original bytes. The roster row keeps only `ref_hash`; the Risu module asset tuple
keeps the exact path returned by `saveAsset`. A same-hash upload reuses a
readable tuple, but replaces a stale tuple after the new path passes readback.
`POST /v1/characters/ref/hydrate` refreshes the module list, seeds any empty
ref slot from a name-triggered Risu asset (WebP into the module, roster
`ref_hash` only), and fills `ref_preview_url` when the character tab, edit
popup, or 새로고침 runs — not at boot. Lorebook import-fill, asset looks
prepass, and tagged roster merges call the same seed. Generation reseeds the
shot cast when mode is `vibe` or `image`. Existing hashes are never overwritten. `POST /v1/characters/ref/reset` clears every hash, leftover IDB
`char_ref_*` rows, and module `inxref_*` assets.
`POST /v1/chat/restore-chrome` remounts PocketRisu chat cards so the
header name and avatar HTML are painted again. It does not delete or
replace stored image files.
Character list rows may include `ref_hash` / `ref_configured` / `ref_preview_url`.
For V4.5 shots, only explicit `vibe` or `image` attach a stored ref. `off`
and unknown values send none.
Every available shot-character ref is collected; there is no fixed count cap.
V5 and other models skip per-character ref/vibe preparation. Generation loads
each shot character's ref by that row's scope+id (session and global tabs do not
share hashes). Empty slots seed from a name/alias-triggered Risu asset first;
an existing hash is never overwritten.
The tagger skips `inxref_` assets so stored refs are not reused as look files.

`card.fixed_prompt_prefix` / `card.fixed_prompt_suffix` (strings, default `""`,
max 8000 chars each): always wrapped around the assembled positive after
person-count tags and before NAI quality tags. Card settings → 생성 옵션 shows a
2-column pair of textareas, a dedicated save button, plus JSON export/import
(`{ fixed_prompt_prefix, fixed_prompt_suffix }`).

`card.llm_reverse_bar` and `card.llm_tag_cal` (booleans, default `false`) sit
next to JSON retry. Reverse-bar prepends `jailbreak` / `prefill` /
`prefill_user` pack prompts (already-accepted role turns) to every LLM call.
Tag-cal appends a mid-tag `%%` instruction and strips `%` then restores
`wfsn`→`nsfw` on the reply. The LLM connection probe uses `plain: true` and
skips both.

`card.stream_keywords_enabled` (boolean, default `false`) is the dashboard
toggle for mid-stream keyword gen. `card.stream_keywords` is still the needle
box (empty = off). Missing toggle on old saves becomes `true` when the box
already has a usable needle (≥3 chars). Independent of `card.execute` and
`card.auto_gen_on_reply`. `card.execute === "manual"` still blocks gen when
the user clicks a bubble; reply auto-gen and stream-keyword gen do not.

### LLM role profiles (`settings.llm` + `settings.llm_roles`)

`settings.llm` remains the **메인 태깅** profile (key name unchanged — no
migration). Secondary roles live under `settings.llm_roles`:

| Role id | Used for | Default |
|---|---|---|
| `autotag` | vision autotag (character chips / models) | `follow_main: true` |
| `asset_char` | asset NAI looks prepass (`char_looks`) | `follow_main: true` |

`resolveLlmRole(settings, role)` (`src/domain/llm/roles.ts`): `main` →
`settings.llm`; otherwise `follow_main` (or missing role) → `settings.llm`;
own profile → role fields only (no merge with main). Command rewrite /
preprocess / unscoped model test stay on main. A stored legacy `curator` blob
is dropped by normalization and resolves to main.

GET settings blanks each role's `api_key` / `service_account_json` and sets
`api_key_configured` / `service_account_configured` like the main LLM.
Export still redacts `api_key` recursively (including under `llm_roles`).

Vertex uses `https://aiplatform.googleapis.com` for region `global`; regional
hosts keep the `<region>-aiplatform.googleapis.com` form. Its OpenAI-compatible
request prefixes bare `gemini-*` model IDs with `google/` (already qualified IDs
are unchanged). SA writes and removals await storage and verify the saved SA
values before reporting success. `clearServiceAccount: true` works without a
`service_account_json` field, on main and each role independently; an empty JSON
field without the clear flag preserves the credential. The models UI shows an
SA status and an immediate `SA 제거` button instead of a removal toggle.

Models tab UI (asserted vendor patches): LLM subtabs
(메인 태깅 / 오토태그 / 에셋캐릭 / 만화생성) plus a FISHTTS display slot that
reuses the vendor `curator` tab id as a placeholder; NovelAI/Comfy stays **one shared**
block below. Secondary source selects include 「태깅 LLM 따라가기」
(`follow_main`). Save PUT sends `{ llm, llm_roles, nai }`; LLM connection test uses
the active tab's resolved profile in `POST /v1/models/test`.
NAI 「연결 테스트」 saves `{ nai }` (including `api_keys_v5` / `api_keys_v4`) then
`POST /v1/nai/test` with the same draft so a just-typed key is stored before Anlas.
Comfy and a non-official `request_url` persist and return `ok` without `/system_stats`
or Anlas (공식 `image.novelai.net/ai/generate-image` only probes Anlas).

### Retired curation pipeline

The curation pipeline (two_stage / embed_snap, catalog, embeddings, the
`/v1/curation/*` routes, the `curation_refine` / `curation_embed_hint`
prompts, the `curator` LLM role, and legacy `card.composition_curation`) was
removed. `migrateSettings` deletes a stored `settings.curation` block and pins
`card.composition_curation` to `false`. Orphan device-store rows (catalog /
embeddings) and shot-level `curation_*` fields are left inert: the tagger and
job pipeline never read them, and generation only passes through a shot's own
`curation_fixed_positive` text if present. Shot-tag popup prefers the **stored**
`characters[].prompt` (generation / image metadata); live roster rebuild is only
a fallback when that prompt is empty.

Keys: `author_note` (main tagger), `asset_author_note`, `global_author_note` (main + asset looks + comic LLM),
`tagger, format, prefill, prefill_user, jailbreak, preprocess, preset_1, lore_inject,
char_inject, appearance_inject, asset_tags_inject, autotag`.

### Jobs
| Route | Notes |
|---|---|
| `POST /v1/jobs/create` | → `{ job_id }` (**202**) or `{ busy: true }` / `{ error: { code: "busy" } }` |
| `POST /v1/jobs/retarget-hash` | While a job runs: if same char/chat/msg/role and text Dice≥60% vs job-start preview, set **save** `content_hash` (lock key unchanged) + rebind published siblings |
| `POST /v1/jobs/busy-message` | `{session_id, character_id, chat_id, message_index, role}` → `{ busy, job_id? }` — active job for that turn (hash ignored); UI skips Ka |
| `POST /v1/jobs/stop` | `{session_id?}` → `{ stopped, job_ids, reroll_stop }` — soft-stop active jobs **and** message reroll batches (keep published / finished shots; do not abort in-flight LLM/NAI; remaining shots/rerolls skip). UI may clear busy immediately. A job that reaches `error` (tagger JSON after the optional one retry, or any other fail) keeps that state; the poll shows `JSON 오류 · 생성실패` (or `progress.message`) then drops `jobProgress` and the in-flight lock after 1s without calling this route. The second tagger JSON miss after `llm_json_retry` throws `JSON 오류 · 생성실패`. |
| `/v1/jobs/:id` | `{ ok, state, error?, progress? }`, state ∈ `queued\|tagging\|generating\|done\|cancelled\|error` |

Auto-gen (`Ka`): after soft rebind/retarget, skip `Be` when (1) `busy-message` is true, or (2) gallery already has cards for the same char/chat/msg/role (hash may differ). Generate only when neither applies.

Create body: `session_id, character_id, character_name, chat_id, chat_name,
unified_session_id, source_session_ids[], char_index, chat_index, assistant_text,
message_index, message_role, content_hash, recent_messages[], lorebook[],
lore_trigger_keys[], character_description, persona_description, force`.

### Gallery / cards
| Route | Notes |
|---|---|
| `/v1/gallery?session_id=&limit=&hashes=` | `{ items: Card[], total, window_oldest_at }` — `items` is the newest `limit` cards **plus** every card whose `content_hash` is named in `hashes` (comma-separated or repeated), so a shot on an old message still ships. `total` is the session card count and `window_oldest_at` the oldest timestamp the window reached (`null` when it covered the session); a caller merging a window into a cache prunes against that edge |
| `/v1/gallery/explore?limit=` | `{ folders[], items[] }` — folder rows use `key`, item rows use `folder_key` |
| `/v1/gallery/favorites` · `POST` `{ids}` | explorer favourites |
| `POST /v1/gallery/unlink` | `{session_id, content_hash, message_index, host_message_id?}` — force retag clears hash, index, and host id so shots cannot reattach |
| `POST /v1/gallery/rebind-hash` | `{session_id, card_ids[], to_hash, assistant_preview}` |
| `POST /v1/gallery/delete` | `{card_ids[]}` **or** `{folder_key}` |
| `POST /v1/gallery/export` | `{all\|folder_key\|card_ids}` → `{ok, zip_base64, filename, count}`. ZIP paths are `{chat}/000001_{old download name}.webp` for one character (or 이캐릭터 전체보기), and `{character}/{chat}/000001_…` for 전체 ZIP. Newest-first **per chat**. (`.png`/`.jpg` only when the stored bytes are not WebP). Entry names are UTF-8 (bit 11 only — no Info-ZIP Unicode Path extra; Explorer calls that extra a damaged ZIP). Import still accepts legacy `images/{id}.png` and names without the 6-digit prefix. |
| `POST /v1/gallery/import` | `{zip_base64, prefer_new_ids}` → `{ok, imported, report}` — looks up bytes by manifest path, then legacy `images/{id}.png`, then basename with `NNNNNN_` stripped |
| `GET /v1/cards/:id/nai-prompt` | image NovelAI tags for the shot-tag form: `{ok, main_prompt, negative_prompt, characters[], model, width, height, steps, cfg_scale, cfg_rescale, sampler, scheduler}` — pixels of that one card |
| `POST /v1/cards/nai-from-image` | `{image_data_url}` → same shape as nai-prompt. No card write. Missing bytes → `{ok:false, error:{code:bad_request}}` |
| `POST /v1/cards/:id/tags` | `{main_prompt, negative_prompt, characters[]}` — persist slim cast only; main/neg stay on the file |
| `POST /v1/cards/:id/studio-generate` | assembled prompts → NAI replay bytes only (`{ok, image_data_url, seed}`). Does not replace the card |
| `POST /v1/cards/:id/studio-commit` | center-canvas bytes + tags → NEW card id at the same place (reroll-style: location / content_hash / cast inherited, old row dropped, `{ok, replaced, card}`). Tags-only commits (no canvas bytes) keep the old same-id path. Tag studio then calls `__INLAY_REPLACE_INLINE_PHOTO__` with the new id so the inline slot flips like a reroll |
| `POST /v1/cards/:id/reroll` | `{mode:"nai", overrides?}` → `{ok, card, replaced?}` — replay file sampler/size/base + new seed; keep file char captions; roster rebuild only when a slot prompt is empty. Comic never resolves names |
| `POST /v1/messages/reroll` | `{session_id, content_hash, message_index}` |
| `/v1/images/:id`, `/v1/images/:id.json` | raw bytes / placement sidecar |

Card fields the UI reads: `id, content_hash, host_message_id, session_id, message_index, paragraph,
shot_index, y_percent, anchor_percent, read_percent, created_at,
main_prompt, negative_prompt, assistant_preview, text, characters[],
character_name, chat_name, folder_key`. Display URLs come from
`resolveImageUrl(card)`, never from a field on the row (see the image-URL note
above).
`host_message_id` is Risu's per-message id when the host exposes one. Link
prefers that over `content_hash`; hash and the Dice≥60% rebind remain fallbacks.
`chatId` is the chat, not a turn, and is never stored here.

### Characters
| Route | Notes |
|---|---|
| `/v1/characters?session_id=&character_id=` | `{ characters[], global[], appearance, disabled_globals[] }` |
| `POST /v1/characters` | 6 body shapes: bulk save, single `character`, unified patch (`root_session_ids`), move-to-global, delete (`root_delete[]`), create |
| `POST /v1/characters/global-toggles` | `{character_id, disabled_globals[]}` |
| `POST /v1/characters/unify` | `{target_session_id, source_session_ids[], include_target}` |
| `POST /v1/characters/triggered` | `{message, session_id, character_id, unified_session_id?, source_session_ids[]}` → `{ characters[] }` — same roster + alias match as the main tagger's "Characters in this message". Picker thumb = 예제샷, else 참고이미지 |
| `GET /v1/characters/ref?character_id=&scope=` | `{ configured, preview_url, scope }` — `scope` is `global`/`__global__` or the chat session id (`session` + `session_id` also works) |
| `GET /v1/characters/import-picker?kind=persona|session&character_id=` | `{ items[{kind,id,name,preview,keys[],text,badge,has_image}], lore_empty }`. Lore `badge` = activation keys; CharInfo `badge` = `charinfo`. Picker filters live on name/keys/text; select-all applies to visible rows only. Checkboxes start unchecked. |
| `POST /v1/characters/analyze-asset` | `{image_b64, asset_name, name, aliases, session_id, character_id}` → normalized look slots plus `source: metadata|vision`. NovelAI/WebP metadata uses the `asset_char` looks prepass; vision autotag is used only when no usable metadata exists. This route does not save the roster. |
| `POST /v1/characters/import-fill` | `{scope, session_id, character_id, parallel, xnai, picks[{kind,id}]}` → `{filled, failed[], vision_to_text}` timeout 160s. Lore and persona/CharInfo meta looks are chunked 8 per LLM call; `parallel` fires up to 10 chunks at once. Lore: asset meta + `char_looks`; if matching assets have no meta, one best-ranked file (default/normal/profile/smil*) via autotag; else lore body + `char_looks`. Persona/CharInfo with NAI meta: same looks messages + `mergeRosterFromTagged`. No meta + image → autotag then roster merge; else description + `char_looks`. `xnai` (popup toggle, default off) adds `lb-xnai.lb.extra` as an author's-note system turn on the lore-text path only — never on asset-meta or autotag. A name-matched asset file (meta or not) is also stored as that character's reference image when the slot is empty. |
| `POST /v1/characters/lorefilter` | `{character_id, selected[]}` save, or `{character_id, rescan:true, lorebook?}` seed via `asset_char` |
| `POST /v1/characters/ref` | `{character_id, scope, session_id?, image_b64}` or `{character_id, scope, copy_from, copy_from_scope?}` or `{character_id, scope, clear:true}` — bytes as-is |
| `POST /v1/characters/ref/clear` | `{character_id, scope, session_id?}` |
| `/v1/appearance/:sessionId` · `POST` | legacy alias |
| `GET/PUT /v1/session-author-note` | `{session_id, prefix, suffix, preset_id, location, wear?, costumes?, text}` — per-chat note (`text` is prefix+suffix; a legacy string body becomes `prefix`). `location` is the current session place tags (omit on PUT to keep). `wear` is the remembered outfit map (`{id: {name, wear}}`, id-keyed, written from successfully saved shots in narrative order; omit on PUT to keep; omitted from responses when empty). `costumes` stores `{id:{name,scope,costume}}` in `omni.nexus.note`; responses return an entry array and omit it when empty. Current costumes belong to the actual chat, without changing roster defaults. Manual changes made during generation win over a late job result. After `global_author_note` and the lane note (`author_note` / `asset_author_note` / comic tab). Session wins. |
| `GET/PUT /v1/session-author-note-presets` | `{items[{id,name,prefix,suffix}]}` |
| `GET/PUT /v1/character-command-presets` | `{items[{id,name,cmd,cmd_post?}]}` — live list is `card.command_presets`; `onx_char_command_presets` still merges |
| `POST /v1/characters/preview-shot` | style preset + form tags → `{preview_url,image_b64}` (no auto vibe/ref; no `1girl, smile,` look-plate tail) |
| `GET/POST /v1/characters/example-shot` | shared 예제샷 (`example_hash`, not `ref_hash`). POST `{image_b64}` stores, `{generate:true}` builds then stores, `{clear:true}` or `POST .../clear` removes. `예제샷참고이미지로` copies that shot to `POST /v1/characters/ref` (not studio `/v1/nai/vibe`) |
| `POST /v1/characters/:id/command-rewrite` | `{instruction, character}` → `{character}` form deltas only |

Record: `id, name, original, aliases[], surname, given_name, surname_variants[],
given_name_variants[], appearance, attire, accessories, costumes[], active_costume,
attire_locked, accessories_locked, priority, gender (`girl`|`boy`|`other`|``),
hair_color, hair_style, eye_color, height, age, penis_size,
`ref_configured?`, `ref_preview_url?`, `example_hash?`, `example_configured?`, `example_preview_url?`.
`attire` = clothes + permanent jewelry; `accessories` = weapons/props only.
`costumes[]` = named wardrobe sets (`name`, `note?`, `attire`, `accessories`);
index **0** is the generation default when a shot has no `costume` pick.
`active_costume` is the UI select index (editing mirror into `attire`/`accessories`).
`attire_locked` / `accessories_locked` default **ON** (`!== false`). When locked, freeform shot
`attire`/`accessories` are ignored for generation; a shot `costume` name/index still
selects from the roster catalog. When unlocked, shot wear applies to
**that shot's caption only** — it is never written back to the roster. Roster wear
changes via character edit/create; or when appearance is still empty, a
`new_characters` re-collect **overwrites** appearance+attire+accessories (and may
fill `costumes[]`). Viewer character save may send `stamp_card_id` so that card's
cast keeps `costume` across rerolls without changing `costumes[0]`.
UI: dashboard `card.costume` toggle injects the catalog into the main tagger;
character tab / edit popup costume bar: name · when-to-use note · delete · slot
save · make-default · select (top option = add). At least one costume is kept.
Autotag returns the same look fields plus `gender`. Missing roster `gender` is
filled once from exact look tokens (`girl`/`woman`/`female` vs `boy`/`man`/`male`)
then persisted.

### NovelAI / models / autotag
`POST /v1/models/test` `{llm?}` · `POST /v1/nai/test` · `POST /v1/nai/probe` ·
`POST /v1/nai/reference` `{image_b64}` · `POST /v1/nai/reference/clear` ·
`POST /v1/nai/vibe` `{image_b64, information_extracted, strength}` ·
`POST /v1/nai/vibe/clear` · `/v1/nai/reference` · `/v1/nai/vibe` ·
`POST /v1/autotag` `{image_b64, threshold}` → `{ok, appearance, attire, accessories, tags, text}`
`POST /v1/presets/from-image` `{image_b64, filter_tags?}` → `{ok, positive, negative, cfg_scale, cfg_rescale, name, model_family}`. `filter_tags` defaults true.
`POST /v1/presets/look` `{preset_id, image_b64}` · `POST /v1/presets/look/clear` `{preset_id}` ·
`POST /v1/presets/look/generate` `{preset_id, positive?, negative?, model_family?}` →
`{ok, look_hash, preview_url}` (appends `1girl, smile,`; stores module webp like char-ref).
Text-chunk Description can fill positive without `uc`; extractor then keeps
looking in stealth so file-open and paste both get the negative when it is
still in the pixels.

### Storage migration (2.4 → 2.5)
One-time move of pre-2.5 gallery pixels into the Risu gallery module, plus the
retention passes boot used to run on every start. Dashboard button
`nx-migrate-legacy` (2.4 데이터 이전) starts it and polls status.

| Route | Notes |
|---|---|
| `GET /v1/storage/migrate/status` | `{ok, migrated_version, pending_images, status}` |
| `POST /v1/storage/migrate` | starts and returns immediately: `{ok, started, total, status}` |
| `POST /v1/storage/migrate/cancel` | `{ok, cancelling}` — stops after the current batch |

`status` is `{running, phase, done, total, failed, freed_bytes, error,
finished_at, migrated_version}`; `phase` is one of `idle · images · cleanup ·
purge · done · cancelled · error`. Polling every ~400 ms is enough — the engine
commits one Risu DB write per 25 images.

Deleting the originals is irreversible. It happens per image and only after the
bytes have been read back out of the module, so `failed > 0` means those images
kept their legacy rows. The completion stamp is written only when
`failed === 0` and the run was not cancelled; until then boot keeps scanning and
the button stays useful. Pressing it again resumes (a row that already has an
asset path is not rescanned). `pending_images` is what the button badge shows.

Legacy save-file keys (`nxstore_*`, `native_settings`, `nxref_image`,
`nximg_*`) are only removed when the device store is IndexedDB — see
`src/storage/device-store.ts`. On a host where `pluginStorage` *is* the device
store those keys are the live data.

### Debug
`/v1/debug`, `POST /v1/debug/clear` → `{ events[], by_stage{}, env{} }`
`POST /v1/debug/asset-tags` → probe report; applies lorefilter when `character_id` set (same as job head)

### Errors
404 unknown path · 405 unsupported method · 500 handler failure. Errors carry
`.status` and `.data.error.message`; the UI surfaces the latter.

---

## 4. Plugin arguments

Declared in the header; read by the UI via `risuai.getArgument`.

| Arg | Default | Used for |
|---|---|---|
| `inlay_enabled` | `true` | master toggle |
| `inlay_capture_delay_ms` | `1400` | quiet time before capture |
| `inlay_debug` | `false` | console verbosity |

`inlay_backend_url` and `inlay_backend_token` are still *read* by the UI but are
dead — the patched fetch path ignores them. `inlay_request_timeout_ms` is read but
undeclared, so it is always blank → 120000 ms.

---

## 5. Client-side only (no backend involvement)

Risu host integration and message DOM scanning, overlay/floating-viewer mounting,
viewer geometry (`risuai.pluginStorage` keys `viewerGeo`, `viewerIconGeo`,
`viewerCastOpen`, `viewerMinimized`), settings-panel tab routing and autosave
debounce, preset/character JSON file download, explorer marquee + lightbox, the
in-chat debug log ring buffer, and the 2200 ms gallery cache.

The floating viewer is a single-shot glass window (no gallery strip, no
`galleryUi` object): hovering a chat shot shows that card's pixels via the shared
blob cache (miss keeps the previous image while warming in the background), and
its buttons dispatch the existing inline-shot actions for the hovered card
through a pinned footer target. Collapse mode `viewer_minimize_mode` is
`buttons` (default) or `bubble` (52 px circle, tap to expand); legacy values
`icon`→`bubble`, `toolbar`/`actions`→`buttons` are normalized on settings write.
Marker clicks and the open-gallery action feed the viewer instead of mounting
the old viewer window (`await lt()` no longer occurs in the bundle).


## Omni settings migration (2026-09-13)

The settings surface is extracted from `docs/settings-ux-preview.html` at build time.
`src/settings-ux/` retains the preview pane wrappers, checkbox structure and mobile
layout. Vendor values are serialized into native form attributes; behavioral data
attributes are retained, but vendor layout classes and button labels are not copied.
Nonvisual compatibility controls preserve legacy readers and delegated actions.
Model, card and dashboard changes use the existing queued settings writer;
character and prompt edits use their existing API routes without repainting the form.

Session storage now reads exact chat records from `localLore`, in the inactive
entry named `omni.nexus.data`. Its keys are empty and `alwaysActive` is false, so
Risu does not inject its JSON into model prompts. Existing `onx_*` identifiers and
plugin name remain unchanged. Legacy values remain recovery backups, and writes
are read back before reporting success. Explicit empty records mask the backup.
Logical unified gallery packs are physically partitioned by image location's
character/chat ids; global and character-wide roster records stay in pluginStorage.
Records lacking an unambiguous durable chat identity retain their legacy storage
instead of being attached to whichever chat happens to be open.

`npm test` includes `test:settings-ux` (Playwright; Windows uses installed Edge,
other systems require Playwright Chromium). It mounts the actual bundle with a
mock host, checks responsive layouts and form round trips, and compares the
spinner/baked image dimensions at portrait, landscape and square ratios.
Live-host scroll behavior and permission prompts still require Risu verification.


## Omni bot-owned roster and durable loading slots

- The visible roster is stored in each Risu character's `globalLore` entry named
  `omni.nexus.data.global` (empty key, `alwaysActive: false`, normal mode).
  `characters` remains the wire field for the single roster; `global` is an empty
  compatibility field. Root-session fanout and shared-global toggles no longer write.
  No legacy roster migration or read fallback is performed.
- Stored loading slots identify job, shot and intrinsic dimensions:
  `[[@inrayspinner::JOB_SHOT::WIDTH::HEIGHT]]`. Display regex renders the slot;
  completion replaces that exact token with the asset token. Failure/cancellation
  removes only remaining slots for the job. New plugin startup removes abandoned
  loading slots without touching completed bake tokens.
- Model-tab warning accepts either registered NAI credentials or Comfy configuration.
  Generation still validates the selected backend. Message actions retain their
  display toggle and bind to their containing message without user selection.


### Omni roster and note destinations

The bot-owned roster remains in character lore `omni.nexus.data.global`.
The shared `__global__` roster lives in the Omni display module lore
`omni.nexus.data.globalcharacter`. Both entries have empty keys and are not
always active. The move action verifies the destination before deleting the source.
Session author notes now read/write only chat lore `omni.nexus.note`; the legacy
plugin keys remain untouched. The note API requires a real, stable Risu chat ID.
Toolbar order is `🔢 ⚛️ 🔃 👨‍👩‍👧‍👦 🟥 📚 ✒️`.
Each completed image directly replaces its durable spinner after asset storage;
no base64 overlay is requested for this transition. Scroll anchoring re-resolves
live paragraphs/scrollers after host remounts and yields to user scrolling.


### Character editor and asset explorer (0.0.3 follow-up)

- `현재 캐릭터 챗` navigates to the actual current bot; only the bot tile carries
  selection. The shared roster stays a separate destination.
- Character deletion removes local tiles/selection immediately, flushes prior edits
  and serializes the roster mutation. Failure restores only the deleted rows;
  pending reads cannot resurrect them. The sheet heading carries name/status.
- Settings scope selection reads only the requested roster. A shared request
  sequence covers bot and global selection; cached edits paint immediately, while
  late reads are discarded. Pending saves retain their original scope across remounts.
- Reference/example completion publishes a scope + character ID change to the
  runtime cache, hidden compatibility form, tile and open sheet. Reference wins
  over example fallback. Stale reads cannot overwrite a newer image operation.
- Command rewrite keeps results in the dialog until Save; Cancel does not autosave.
  All costume appearance fields, bottoms, empty strings and `[base]` round-trip.
  Same-name `new_costumes` update existing sets. Identical duplicate names merge;
  distinct looks/notes retain their data under unique names. Default promotion is
  idempotent and includes the entire resolved appearance.
- Character example shots append `4::solo, portrait, white background::` to the
  preset plus resolved selected costume, without forced `1girl`. Style reference
  shots append `4::1girl, solo::`. Both preserve the user's positive/negative text.
- `/v1/gallery/explore` inventories character `additionalAssets` names prefixed
  `inxshot_`. Listing/count/search/sort never reads chat lore, message bodies or
  image metadata. Unknown filename sessions appear under `채팅 미확인`.
- `character_order` and `asset_order` describe current-bot-first directory order
  and reverse append order, not creation timestamps. Optional legacy recipe and
  placement fields are empty until an explicit image action reads the file.
- Folder deletion and ZIP inventory use the same asset identity/classification.


### Character tagging controls (0.1.4)

- `card.asset_nai_tags`: existing `off` / `prepass` / `inline`. The generation pane exposes enable and include-in-main toggles over this same value.
- `card.image_analysis_separate`: boolean, default false. Image-bearing character analysis uses the autotag role when enabled; metadata-only inputs remain text. Inline generation receives textual image analysis in this mode.
- `character_common` is the editable shared appearance prompt. Legacy `char_looks`, `autotag`, and `asset_tags_inject` records remain exportable but are no longer injected.
- Shipped defaults preserve existing prompt edits. Per-key applied revisions live in internal `prompt:__applied__:*` meta rows; reading does not acknowledge updates.
- Character asset selection follows the settings picker. Module selection lists active global/selected-character modules separately. New rows append without replacing the editor or roster DOM, and their writes share the live-edit queue.

### Streaming image generation

- `tools/vendor-patches/stream-keyword-runtime.js` consumes cumulative `output` script callbacks. It checks the latest changed text once per second, stops at the first signal, and sends only the preceding body. Reasoning tags and image markers are excluded by `src/domain/prompt/message-body.ts`.
- `[[imgstart]]` works independently of the manual keyword toggle. `card.omni_helper_prompt` defaults off and controls the `⚛️ omni 보조 프롬` module, whose display regex hides the marker. Module writes share `src/storage/module-write.ts` with existing display and image modules.
- Deferred jobs generate before response completion. `/v1/jobs/commit-output` validates the stream ID and exact character/chat/message identity before allowing spinners, images, or speech. Aborted or changed messages keep paid assets without attaching them. The committed-output listener starts ordinary auto-generation only when no streaming job owns the reply.
- The tagger uses `L1`, `L2` body lines; insertion maps these to original source offsets even when reasoning occupies earlier rows. `y_percent` no longer controls generation or placement. Legacy fields remain readable for saved-data compatibility.
- `inline_chat_images` and `persist_chat_images` are required, checked and disabled in the menu. Retired prompt editors and the individual `character_common` reset button are absent; prompt update notices and the shared reset remain.
- Help asks users to disable **Stream Gemini Thoughts** so reasoning remains tagged, and avoid PocketRisu's **strong** streaming optimization when early generation is wanted. The plugin does not change those host settings.
