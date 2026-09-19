# Service contracts

Every module under `src/services/` implements one slice of the backend. This file
pins the exported signatures so the modules can be written independently and
still link. **Change a signature here and in the module in the same commit.**

Legacy line numbers refer to `reference/native-backend.js`, which is the 1.x
backend the behaviour is ported from.

## Ground rules

- Services may import: `core/*`, `config/*`, `storage/*`, `providers/*`,
  `domain/*`, `ui-contract/*`, and `services/context`.
- A service may import another service only in the direction listed under
  "depends on" below. There are no cycles.
- Shared mutable state lives in `services/context.ts`, never in a service module.
- Every user-visible string (errors, labels, Korean text) is copied
  character-for-character from the legacy source.

## `context.ts`

Already written. Provides `getConfig()`, `setConfig()`, `configLock`,
`jobEpochByKey`, `jobRunMeta`, `messageBusyKeys`, and the two preview-URL
accessors.

## `job-locks.ts`

Interprets the message-target lock whose state `context.ts` holds. Extracted
because **two** services gate it — `jobs.ts` when accepting a generation and
`cards.ts` when rerolling — and each originally carried its own copy of the
derivation. Two copies of a lock check are a latent race: if they ever disagree, a
reroll and a generation can write to the same message at once, and the symptom is
a corrupted gallery under a timing window nobody will reproduce on purpose.

Do not re-derive any of this in a caller.

```ts
export const ACTIVE_JOB_STATES: string[];                    // states that still own a target
export type TargetRequest = Partial<JobRequest> & Record<string, unknown>;
export function jobKey(request?: TargetRequest, sessionId?: string): string;
export async function busyJobIdForKey(key: string): Promise<string>;  // '' when free
export interface BusyReply { ok: false; busy: true; error: { code: string; message: string } }
export async function busyReplyForRequest(
  request?: TargetRequest,
  sessionId?: string,
): Promise<BusyReply | null>;                                // null when free
```

Depends on: `core/*`, `storage/stores`, `services/context`. Depended on by:
`jobs.ts`, `cards.ts`.

`jobKey` prefers `content_hash` (it survives message reordering) over
`message_index`, and falls back to `<session>::all` for a whole-session request.
`busyJobIdForKey` returns the sentinel `'message-reroll'` when a reroll holds the
lock, which `busyReplyForRequest` maps to an empty `job_id`.

## `settings.ts` — legacy 3439–3561, 3606–3648, 3773–3838

Owns settings, the prompt store, and the health payload.

```ts
export async function seedPrompts(): Promise<void>;              // 3439
export async function getPrompt(key: string): Promise<string>;   // 3467
export async function setPrompt(key: string, text: string): Promise<ApiResult>; // 3473
export async function listPrompts(): Promise<unknown[]>;         // 3479
export async function saveConfig(): Promise<void>;               // 3496
export function exportSettingsJson(): string;                    // 3520
export async function importSettingsJson(json: string): Promise<ApiResult>; // 3526
export async function resetSettings(): Promise<ApiResult>;       // 3541
export function health(): Record<string, unknown>;               // 3562
export function publicSettings(): Record<string, unknown>;       // 3606
export async function updateSettings(patch: Record<string, unknown>): Promise<ApiResult>; // 3773
```

Depends on: `nai-assets` (for `hasReferenceImageSync` / `hasVibeTransferSync`,
used by `health` and `publicSettings`).

## `nai-assets.ts` — legacy 3649–3772

The two singleton NovelAI reference images.

```ts
export function hasReferenceImageSync(): boolean;                // 3649
export async function hasReferenceImage(): Promise<boolean>;     // 3653
export async function getReferenceImageBytes(): Promise<ArrayBuffer | null>; // 3658
export async function setReferenceImage(png: ArrayBuffer): Promise<ApiResult>; // 3663
export async function clearReferenceImage(): Promise<ApiResult>;  // 3680
export function hasVibeTransferSync(): boolean;                  // 3689
export async function hasVibeTransfer(): Promise<boolean>;       // 3693
export async function getVibeTransfer(): Promise<MetaRow | undefined>; // 3698
export async function getVibeImageBytes(): Promise<ArrayBuffer | null>; // 3702
export async function setVibeTransfer(png: ArrayBuffer, opts: VibeOptions): Promise<ApiResult>; // 3707
export async function clearVibeTransfer(): Promise<ApiResult>;    // 3744
export async function ensureVibeEncoded(): Promise<string>;       // 3753
export async function setCharRefImage(scope, characterId, bytes, opts?): Promise<ApiResult>;
export async function seedCharRefsFromLooks(characters): Promise<number>;
export async function hydrateCharRefs(opts?): Promise<{ session: CharRefHydrateRow[]; global: CharRefHydrateRow[] }>;
export async function resetAllCharacterRefs(): Promise<ApiResult>;

export interface VibeOptions {
  model?: unknown;
  information_extracted?: unknown;
  strength?: unknown;
}
```

Depends on: `asset-tags` (`collectBestLookAssets` for empty-slot char-ref seed).

## `characters.ts` — legacy 3839–4615

Roster, identity, global toggles, cross-session unification.

```ts
export async function listCharacters(scope: string): Promise<CharacterRecord[]>; // 3839
export async function getDisabledGlobals(characterId: string): Promise<string[]>; // 3877
export async function setDisabledGlobals(characterId: string, ids: unknown[]): Promise<ApiResult>; // 3887
export async function getDisabledGlobalsSet(characterId: string): Promise<Set<string>>; // 3929
export async function globalEnabledMap(characterId: string): Promise<Record<string, boolean>>; // 3934
export function rosterStoreSessionId(sessionId: string): string; // 3949
export async function listMergedSessionCharacters(sessionId: string): Promise<CharacterRecord[]>; // 3953
export async function rosterForSession(sessionId: string, characterId?: string): Promise<CharacterRecord[]>; // 3965
export async function loadTaggerRoster(args?: TaggerRosterArgs): Promise<CharacterRecord[]>;
export async function matchTriggeredCharacters(args: TaggerRosterArgs & { message?: unknown }): Promise<CharacterRecord[]>;
export async function matchTriggeredCharactersPayload(body: Record<string, unknown> | null | undefined): Promise<Record<string, unknown>>;
export async function upsertCharacter(scope: string, raw: unknown): Promise<ApiResult>; // 4047
export async function deleteCharacter(scope: string, ref: unknown): Promise<ApiResult>; // 4182
export async function deleteMatchingInSessions(sessionIds: string[], refs: unknown[], characterId: string): Promise<void>; // 4213
export async function patchExistingInSessions(sessionIds: string[], records: unknown[], characterId: string): Promise<void>; // 4241
export async function replaceCharacters(scope: string, records: unknown[], opts?: ReplaceOptions): Promise<ApiResult>; // 4278
export async function getCharactersPayload(sessionId: string, characterId?: string): Promise<Record<string, unknown>>; // 4324
export async function unifyCharacterSessions(targetSessionId: string, sourceSessionIds: unknown[], includeTarget?: boolean): Promise<ApiResult>; // 4348
export async function getAppearance(sessionId: string): Promise<Record<string, unknown>>; // 4375
export async function setAppearance(sessionId: string, appearance: unknown): Promise<ApiResult>; // 4379
export async function mergeRosterFromTagged(args: MergeRosterArgs): Promise<CharacterRecord[]>; // 4385
export async function migrateAppearanceToCharacters(): Promise<void>; // 3451
export async function migrateCharacterIdentity(): Promise<void>;      // 3505

export interface ReplaceOptions { prune?: boolean; rootSessionIds?: string[] }
```

`MergeRosterArgs` mirrors the legacy call site exactly — read it at 4385 and at
the `_runJob` caller before choosing field names.

Depends on: `settings` (for `saveConfig`), `nai-assets` (`seedCharRefsFromLooks` after tagged merge).

## `tagger.ts` — legacy 4779–4979

Builds the LLM tagging request and flattens the reply into shots.
Shared `global_author_note` then the lane note (`author_note` / `asset_author_note` / comic tab) then the session note (session wins). `author_note` is main-tagger only.

```ts
export async function hydrateTaggerCharUser(request: TaggerArgs): Promise<void>;
export async function buildTaggerMessages(args: TaggerArgs): Promise<LlmMessage[]>; // 4779
export async function buildCharacterLooksMessages(
  request: TaggerArgs,
  assetBlock: string,
  assetNames?: string[],
  previews?: AssetLookPreview[],
): Promise<LlmMessage[]>;
export function flattenShots(tagged: unknown): TaggedShot[];                        // 4966
```

Depends on: `characters`, `settings`, `asset-tags`.

## `char-import.ts`

Manual roster fill from the character tab (페소에서 / 가져오기). Lore picks call `collectAssetNaiTags` then `buildCharacterLooksMessages` (same as the job looks prepass, including previews). Matching assets with no NAI meta use `collectBestLookAssets` (one best-ranked file) + autotag, then lore body. Persona/CharInfo with NAI meta pack tags the same way and save through `mergeRosterFromTagged`. Popup `xnai` (next to 동시 요청) adds `lb-xnai.lb.extra` as an author's-note system turn on the lore-text path only. Persona icon and CharInfo image are written first into an empty 참고이미지 slot (`seedImportFaceRefs`, module webp quality 0.9, overwrite false). A matched asset file then fills leftover empty slots (`seedCharRefsFromLooks` in `nai-assets.ts`, overwrite false). The same look-asset seed runs after `mergeRosterFromTagged`, on hydrate, and before a V4.5 vibe/image generation. Picker lore `badge` is the key list; CharInfo is `charinfo`.

```ts
export async function listImportPicker(kind: string, characterId: string): Promise<ApiResult>;
export async function runImportFill(body: Record<string, unknown>): Promise<ApiResult>;
```

Depends on: `tagger`, `characters`, `asset-tags`, `lorefilter`, `nai-assets`, `settings`.

## `generation.ts` — legacy 4980–5216

Turns one shot into an image and records where it belongs.

```ts
export async function buildGenerationForShot(args: ShotArgs): Promise<GenerationPlan>; // 4980
export async function generateImage(plan: GenerationPlan): Promise<ArrayBuffer>;       // 5057
export function buildImageLocation(args: LocationArgs): Record<string, unknown>;       // 5131
export async function readImageLocation(imageId: string): Promise<Record<string, unknown>>; // 5153
export async function writeImageLocation(imageId: string, location: unknown): Promise<void>; // 5158
export function locationFieldsForCard(location: unknown): Record<string, unknown>;     // 5164
export function cardMetaFromLocation(location: unknown): Record<string, unknown>;      // 5194
```

Depends on: `nai-assets` (reference/vibe bytes), `settings`.

## `preset-look.ts`

Picker preview shots for style presets. Module webp + `look_hash` only.

```ts
export async function setPresetLook(presetId: string, png: ArrayBuffer): Promise<ApiResult>;
export async function clearPresetLook(presetId: string): Promise<ApiResult>;
export async function generatePresetLook(body: Record<string, unknown>): Promise<ApiResult>;
export async function hydratePresetLookPreviews(): Promise<void>;
```

Depends on: `char-ref-module`, `settings`.

## `jobs.ts` — legacy 5217–5659

Job lifecycle: dedupe, epochs, cancellation, the run loop, progress reporting.

```ts
export async function createJob(request: unknown): Promise<ApiResult>; // 5296
export async function getJob(jobId: string): Promise<ApiResult>;       // 5630
```

Everything else in this range is internal to the module and must not be
exported. The epoch maps live in `context`.

Depends on: `tagger`, `generation`, `characters`, `settings`, `asset-tags`, `nai-assets`.

## `gallery.ts` — legacy 5660–6075

```ts
export async function galleryExplore(limit: number): Promise<ApiResult>;   // 5660
export async function gallery(sessionId: string, limit: number): Promise<ApiResult>; // 5743
export async function rebindCardsHash(args: RebindArgs): Promise<ApiResult>; // 5797
export async function unlinkCardsForMessage(sessionId: string, contentHash: string, messageIndex: unknown): Promise<ApiResult>; // 5835
export async function deleteCard(cardId: string): Promise<ApiResult>;      // 5889
export async function deleteCards(cardIds: unknown[]): Promise<ApiResult>; // 5900
export async function getExplorerFavorites(): Promise<ApiResult>;          // 5910
export async function setExplorerFavorites(ids: unknown[]): Promise<ApiResult>; // 5916
export async function exportGalleryZip(body: Record<string, unknown>): Promise<ApiResult>; // 5922
export async function importGalleryZip(body: Record<string, unknown>): Promise<ApiResult>; // 5968
export async function deleteFolder(folderKey: string): Promise<ApiResult>; // 6046
export async function getImageBytes(cardId: string): Promise<ArrayBuffer | null>; // 6071
```

**Performance requirement.** `gallery()` and `galleryExplore()` must not hydrate
PNG bytes. 1.x called `idbGet("images", row.id)` per row purely to read
`png?.byteLength`, which decoded every stored image from base64 on every gallery
open. Use `imageMeta(id)` from `storage/stores` instead — it returns
`{ has_png, png_bytes }` from the in-memory index and touches neither storage
nor base64. The emitted `png_bytes` value must be identical.

Depends on: `generation` (location helpers).

## `cards.ts` — legacy 6076–6449

```ts
export async function readCardNaiPrompts(cardId: string): Promise<ApiResult>;
export async function updateCardTags(cardId: string, body: Record<string, unknown>): Promise<ApiResult>;
export async function studioCommit(cardId: string, body: Record<string, unknown>): Promise<ApiResult>;
export async function rerollCard(cardId: string, mode: string, overrides: unknown): Promise<ApiResult>;
export async function rerollMessageCards(args: RerollMessageArgs): Promise<ApiResult>;
```

Depends on: `generation`, `tagger`, `characters`, `gallery`, `settings`.

## `diagnostics.ts` — legacy 6450–6636

```ts
export async function testLlm(llmOverride: unknown): Promise<ApiResult>;   // 6450
export async function testNai(): Promise<ApiResult>;                      // 6490
export async function probeNaiGenerate(): Promise<ApiResult>;             // 6546
export async function evaluateAutotag(bytes: ArrayBuffer, threshold: number): Promise<ApiResult>; // 6636
```

Depends on: `settings`, `nai-assets`.
