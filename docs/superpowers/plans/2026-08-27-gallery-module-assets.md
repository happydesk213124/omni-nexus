# Gallery module assets Implementation Plan

> **For agentic workers:** Implement task-by-task. Storage keys stay frozen.

**Goal:** Persist new gallery pixels as Risu module assets (`saveAsset` / `readImage`) instead of base64 `inx_nximg_*` strings, without rewriting explorer/inline URL paths.

**Architecture:** Card ids and `resolveImageUrl` stay. A dedicated module (`inlay-gallery`, not the char-ref module) holds `[name, path, name]` tuples. `idbPut`/`hydrateImage` are the only I/O swap. Legacy plugin keys remain a read/write fallback when the host has no `saveAsset`.

**Tech Stack:** Existing plugin host APIs, IndexedDB metadata index, WebP @ 0.9 on publish.

## Global Constraints

- Never rename `inx_nximg_*` / `inx_nxstore_images` / plugin id
- Never edit `vendor/` or `dist/` by hand; `npm run build`
- Listing must not `readImage` / `idbGet('images')` (bench)
- No third-party plugin names in product copy
- Imports point downward: `storage/` may use `core/` + `domain/`, not `services/`

---

## Task 1: Pure naming

- `src/domain/gallery/shot-assets.ts` — module id/ns/name, `inxshot_` prefix, parse tuples
- Unit tests in `tests/shot-assets.test.mjs`

## Task 2: Host I/O

- `src/storage/shot-module.ts` — `putShotAsset`, `readShotAssetBytes`, `dropShotAsset`
- Same readback-before-publish rule as char-ref
- Unit tests with a mock `risuai` like `tests/char-ref-module.test.mjs`

## Task 3: Wire persist/hydrate

- `stores.ts`: persist via module when possible; else base64; hydrate path then key
- After module save, write `location.asset_path` and persist the images index inside `imagePersistChain`
- `publishImage` WebP quality 0.9
- Parity host grows `saveAsset` / `readImage` / `getDatabase` so the new path is exercised
- Fallback keeps bench seeds (`inx_nximg_*` only) working

## Task 4: Ship 2.4.23

- Version bump, `npm test`, dist + nightly checkpoint
