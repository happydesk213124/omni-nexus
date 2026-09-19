# Character Reference and Message Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make module-backed WebP character references survive reloads, attach automatically only on NAI V4.5, and make message actions reliable immediately after plugin startup with a triggered-character editor picker.

**Architecture:** Risu module `assets` metadata is the authoritative hash-to-path index and roster rows keep only `ref_hash`. The storage adapter trusts the exact path returned by `saveAsset`, verifies the bytes before publishing the hash, and writes a valid full file name into the module tuple. A pure routing helper turns the configured character-reference mode into an effective V4.5-only mode. Frozen UI changes remain asserted `vite.config.ts` patches: stale action bars are removed before host pointer listeners bind, then the character chip opens a fullscreen picker that resolves aliases through `__INLAY_VIEWER_CORE__` and delegates editing to the existing character editor.

**Tech Stack:** TypeScript 5.9, Vite 8 asserted vendor patches, Node test runner, esbuild test bundles, RisuAI plugin API v3/SafeDOM.

## Global Constraints

- Keep WebP as the preferred stored format at 400px maximum width.
- Never edit `vendor/inlay-nexus-ui.js` or `dist/inlaynexus2.0.js` directly.
- Build only with `npm run build`; commit the regenerated `dist/inlaynexus2.0.js`.
- Keep the plugin id and existing storage keys unchanged.
- Do not add top-level bundle names or CSS imports.
- V5 sends no per-character reference image or vibe payload; V4.5 sends every available character reference.
- Ignore the unrelated untracked root JavaScript file.

---

### Task 1: Make the Risu module index authoritative

**Files:**
- Modify: `tools/build-tests.mjs`
- Create: `tests/char-ref-module.test.mjs`
- Modify: `src/domain/character/char-ref-store.ts`
- Modify: `src/services/char-ref-module.ts`
- Modify: `src/services/nai-assets.ts`
- Modify: `src/services/characters.ts`
- Modify: `src/core/types.ts`
- Modify: `docs/UI-CONTRACT.md`

**Interfaces:**
- Consumes: `risuai.saveAsset(bytes)`, `getDatabase(['modules', 'enabledModules'])`, `setDatabase(...)`, and `readImage(path)`.
- Produces: `putCharRefAsset(bytes): Promise<{ hash; bytes; path }>` only after returned-path readback succeeds; `getCharRefAssetBytes(hash)` resolves through `modules[].assets`.

- [ ] **Step 1: Compile the service for host-contract tests**

Add this entry to `MODULES` in `tools/build-tests.mjs`:

```javascript
'char-ref-module': 'src/services/char-ref-module.ts',
```

- [ ] **Step 2: Write failing Risu v3 host-contract tests**

Create `tests/char-ref-module.test.mjs` with a host whose `saveAsset` intentionally accepts only bytes, returns `assets/<hash>.png`, and stores WebP bytes under that exact key. Assert:

```javascript
const saved = await putCharRefAsset(webpBytes);
assert.equal(saved.path, host.savedPath);
assert.deepEqual(host.db.modules[0].assets[0], [
  `inxref_${saved.hash}.webp`,
  host.savedPath,
  `inxref_${saved.hash}.webp`,
]);
assert.deepEqual(new Uint8Array(await getCharRefAssetBytes(saved.hash)), webpBytes);
```

Add a readback-failure case:

```javascript
await assert.rejects(
  () => putCharRefAsset(webpBytes),
  /저장한 참고 이미지를 다시 읽지 못했습니다/,
);
assert.equal(host.db.modules[0].assets.length, 0);
```

Add a reload case by clearing the module's in-memory index, preserving only the host database, and asserting the hash resolves from `modules[].assets`.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npm run unit -- --test-name-pattern="char ref module"
```

Expected: FAIL because tuple field 3 is currently only `webp`, readback failure only warns, and the roster/path fallback remains authoritative.

- [ ] **Step 4: Implement the minimum storage fix**

In `src/services/char-ref-module.ts`:

```typescript
const path = normalizeAssetPath(cleanText(await host.saveAsset(payload), 800));
const readBack = await readAssetBytes(path);
if (!readBack || readBack.byteLength < MIN_IMAGE_BYTES) {
  throw new Error('저장한 참고 이미지를 다시 읽지 못했습니다');
}
assets.push([name, path, name]);
```

Keep WebP bytes and the exact returned path. Do not reconstruct the physical path from hash or extension. Write the module metadata only after readback passes, then rebuild the in-memory index from the saved tuple. Keep module activation and metadata in one `setDatabase` call.

Remove `CHAR_REF_PATHS_META_KEY`, roster `ref_path`, path-map helpers, and fallback-path parameters. Restore the contract documented in `char-ref-store.ts`: roster rows store only `ref_hash`; the module tuple owns the returned path.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm run unit -- --test-name-pattern="char ref module|charRef"
```

Expected: PASS with no warnings.

- [ ] **Step 6: Checkpoint the storage slice**

Run typecheck, build, and the focused tests, then commit source, tests, docs, and regenerated `dist/inlaynexus2.0.js` with a `checkpoint:` message.

---

### Task 2: Attach character references automatically on V4.5 only

**Files:**
- Modify: `tests/nai-routing.test.mjs`
- Modify: `src/domain/nai/routing.ts`
- Modify: `src/services/generation.ts`
- Modify: `docs/UI-CONTRACT.md`

**Interfaces:**
- Produces: `effectiveCharacterReferenceMode(model, configuredMode): 'off' | 'vibe' | 'image'`.
- Consumes: the route's actual model after per-shot V4/V5 routing.

- [ ] **Step 1: Write the failing routing-policy test**

Add:

```javascript
test('character refs are automatic on V4.5 and disabled on V5/other models', () => {
  assert.equal(effectiveCharacterReferenceMode('nai-diffusion-4-5-full', 'off'), 'image');
  assert.equal(effectiveCharacterReferenceMode('nai-diffusion-4-5-full', 'image'), 'image');
  assert.equal(effectiveCharacterReferenceMode('nai-diffusion-4-5-full', 'vibe'), 'vibe');
  assert.equal(effectiveCharacterReferenceMode('nai-diffusion-5-full', 'image'), 'off');
  assert.equal(effectiveCharacterReferenceMode('nai-diffusion-4-full', 'image'), 'off');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm run unit -- --test-name-pattern="character refs are automatic"
```

Expected: FAIL because `effectiveCharacterReferenceMode` does not exist.

- [ ] **Step 3: Implement and consume the pure policy**

In `src/domain/nai/routing.ts`, resolve the model and return `off` unless it contains `nai-diffusion-4-5`. On V4.5 preserve explicit `vibe`; treat `off`, unknown, and `image` as `image`.

In `src/services/generation.ts`, derive `charRefMode` from the actual `routeModel`, not directly from the saved setting:

```typescript
const charRefMode = effectiveCharacterReferenceMode(routeModel, card.char_ref_mode);
if (charRefMode !== 'off') {
  // Existing cast loop; image mode remains capped at four references.
}
```

This makes the stored image itself the enable signal on V4.5 and prevents character-reference encoding work on V5.

- [ ] **Step 4: Run focused and payload tests and verify GREEN**

Run:

```powershell
npm run unit -- --test-name-pattern="character refs|V5 launch has no director"
```

Expected: PASS.

- [ ] **Step 5: Checkpoint the generation slice**

Run typecheck, build, and unit tests, then commit source, tests, docs, and regenerated bundle.

---

### Task 3: Remove dead startup action bars and rehydrate after binding

**Files:**
- Modify: `tests/build-layout.test.mjs`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces vendor-patched helpers `clearMsgActionBars(doc)` and `schedulePointerSelect(reason, delayMs)`.
- Consumes the existing SafeDOM `querySelectorAll`, `unwarpSafeArray`, host event binding, and `Da(..., { source: 'provisional' })`.

- [ ] **Step 1: Write failing structural tests**

Update the message-action build test to assert:

```javascript
assert.match(body, /async function clearMsgActionBars/);
assert.match(source, /await clearMsgActionBars\(e\)/);
assert.match(source, /schedulePointerSelect\("bind", 0\)/);
assert.match(source, /function schedulePointerSelect\(reason, delayMs = 1e3\)/);
```

Keep assertions that forbid `elementFromPoint`, direct host DOM insertion, and direct per-chip listeners.

- [ ] **Step 2: Run the focused build-layout test and verify RED**

Run:

```powershell
node --test --test-name-pattern="action bar|msg chips" tests/build-layout.test.mjs
```

Expected: FAIL because stale bars are not cleared before listener binding and the scheduler has a fixed one-second delay.

- [ ] **Step 3: Implement asserted vendor patches**

In the `VENDOR_MSG_ACTION_PATCH` block, add `clearMsgActionBars(doc)` that unwraps every `[x-inlay-msg-actions]` node and removes it.

Change the pointer-select scheduler:

```javascript
function schedulePointerSelect(reason, delayMs = 1e3) {
  if (t._pointerSelectTimer) clearTimeout(t._pointerSelectTimer);
  t._pointerSelectReason = String(reason || "");
  t._pointerSelectTimer = setTimeout(() => {
    t._pointerSelectTimer = null;
    runPointerSelect(t._pointerSelectReason).catch(() => {});
  }, Math.max(0, Number(delayMs) || 0));
}
```

Before binding the host pointer listeners, remove bars left by the previous plugin instance. Immediately after binding, call `schedulePointerSelect("bind", 0)` so only newly owned bars become visible.

- [ ] **Step 4: Run focused tests and build**

Run the focused layout tests and `npm run build`. The asserted needle must fail if the frozen upstream text drifts.

- [ ] **Step 5: Checkpoint the startup slice**

Commit `vite.config.ts`, tests, and regenerated bundle.

---

### Task 4: Open a triggered-character picker from the message chip

**Files:**
- Modify: `tests/build-layout.test.mjs`
- Modify: `vite.config.ts`
- Modify: `docs/UI-CONTRACT.md`

**Interfaces:**
- Consumes: `t.selectedMessage.text`, `ensureViewerRosterLoaded()`, `__INLAY_VIEWER_CORE__.matchCharactersInText(text, roster)`, `k.showContainer('fullscreen')`, existing `Ua(character)`.
- Produces: `openMsgCharPicker(message)` and a fullscreen modal that lists only characters triggered in that message.

- [ ] **Step 1: Write failing structural tests**

Replace the old “no picker” assertion with:

```javascript
assert.match(body, /async function openMsgCharPicker/);
assert.match(body, /matchCharactersInText/);
assert.match(body, /showContainer\("fullscreen"\)/);
assert.match(body, /await Ua\(picked\)/);
assert.match(body, /await openMsgCharPicker\(A\)/);
```

Also assert the picker root is removed on backdrop/Escape and that it never appends a host popup without opening the plugin fullscreen container.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern="in-message action bar" tests/build-layout.test.mjs
```

Expected: FAIL because the character chip currently opens the general character settings tab.

- [ ] **Step 3: Implement the fullscreen picker**

Add `openMsgCharPicker(message)` in the same asserted patch section:

1. Resolve the live roster.
2. Call `matchCharactersInText(message.text, roster)`.
3. If no character matches, show a short host toast and return.
4. Call `showContainer('fullscreen')`, hide the floating viewer, and render a plugin-document backdrop plus one button per matched character.
5. On selection, remove the picker, keep the fullscreen shell open, and call `Ua(picked)` so the existing character-tag editor owns save/close behavior.
6. On backdrop or Escape, remove the picker, restore the viewer, and hide the container only when the picker opened it.

Change the `char` branch:

```javascript
if (kind0 === "char") {
  try {
    await openMsgCharPicker(A);
  } catch (err) {
    y("error", "msg.char_picker.fail", err?.message || err);
  }
  return;
}
```

- [ ] **Step 4: Run focused tests and build**

Run the focused build-layout test, typecheck, and build.

- [ ] **Step 5: Checkpoint the picker slice**

Commit `vite.config.ts`, tests, docs, and regenerated bundle.

---

### Task 5: Full verification and handoff

**Files:**
- Verify all modified source, tests, docs, and `dist/inlaynexus2.0.js`.

- [ ] **Step 1: Check IDE diagnostics**

Read diagnostics for all edited TypeScript files and fix newly introduced errors.

- [ ] **Step 2: Run the repository verification gate**

Run:

```powershell
npm test
```

Expected: typecheck, unit, build, audit, smoke, bench, and parity all pass.

- [ ] **Step 3: Verify the working tree**

Confirm the unrelated untracked root JavaScript file remains untouched. Confirm every intended source change and regenerated `dist/inlaynexus2.0.js` is committed on `nightly`.

- [ ] **Step 4: Report evidence**

Summarize the storage contract, V4.5/V5 behavior, startup rebind, character picker, commit ids, and the exact verification command/result.
