# OPTIMIZATIONS

What actually got faster in 2.0, how it was measured, and which of the changes
carry risk worth knowing about.

Every number here comes from `npm run parity`, which replays the same 118-step
scenario against the 1.x backend and this one on a single deterministic mock host
(`tools/parity/host.mjs`: fixed clock, seeded randomness, counted storage calls).
Reproduce with `npm run parity` and read the two `[parity]` summary lines.

---

## Measured result

| Metric | 1.x | 2.0 | Change |
|---|---|---|---|
| Storage writes | 147 | 44 | **−70%** |
| Bytes written | 1,732 KB | 405 KB | **−77%** |
| Storage reads | 21 | 21 | unchanged |
| Wall time | 225 ms | 160 ms | −29% |

Wall time is the least meaningful column: the mock host resolves I/O instantly,
so it understates the win. On a real device every one of those 103 avoided writes
is an IndexedDB transaction that serialises an entire store to JSON first. The
write columns are the ones that matter.

Per key, which shows the shape of the problem:

| Key | 1.x writes | 1.x bytes | 2.0 writes | 2.0 bytes |
|---|---|---|---|---|
| `inx_nxstore_meta` | 47 | 1,215 KB | 3 | 81 KB |
| `inx_native_settings` | 15 | 268 KB | 15 | 268 KB |
| `inx_nxstore_cards` | 17 | 104 KB | 3 | 19 KB |
| `inx_nxstore_characters` | 26 | 67 KB | 3 | 12 KB |
| `inx_nxstore_jobs` | 12 | 53 KB | 3 | 19 KB |
| `inx_nxstore_images` | 16 | 24 KB | 3 | 5 KB |

`inx_nxstore_meta` alone accounted for 70% of all bytes written in 1.x. Settings
are the one row deliberately left alone — see below.

---

## Where the wins came from

### 1. Coalesced persistence (the big one)

In 1.x every row mutation immediately re-serialised its **whole** store and wrote
it. A job touching one card 47 times wrote the entire meta store 47 times.

2.0 marks the store dirty and schedules one flush 25 ms later
(`PERSIST_DEBOUNCE_MS` in `src/storage/stores.ts`). A burst of mutations
collapses into a single write of the same final bytes.

Correctness rests on the in-memory `Map` being the source of truth: a read
following a write returns the fresh value whether or not the flush has landed, so
no caller can observe the delay.

**The risk this accepts:** a mutation followed within 25 ms by the tab closing is
lost, where 1.x had already written. Two things bound that exposure:

- A job reaching `done`, `error` or `cancelled` awaits `flushPersist()` before
  returning (`src/services/jobs.ts`). The cards written during a job are images
  the user just paid for; losing one is not an acceptable trade for a write.
  This costs the 5 extra writes visible in the table above.
- `installFlushOnHide()` in `src/storage/stores.ts` flushes on
  `visibilitychange`, so ordinary state — scroll positions, favourites — is
  written when the tab goes away rather than waiting out the timer.

What remains at risk is 25 ms of incidental UI state, which 1.x bought at the
cost of 103 extra full-store writes.

### 2. Lazy image hydration

1.x loaded every image's base64 bytes into memory at boot, then re-serialised
them with the metadata store. 2.0 keeps bytes in their own per-image keys
(`inx_nximg_<id>`) and loads them on demand, de-duplicating concurrent requests
for the same id through an in-flight promise map so a gallery scroll that asks
for one image ten times reads it once.

`inx_nxstore_images` therefore holds metadata only — which is why its write
volume fell from 24 KB to 3 KB.

**This one is fragile, and it broke once already.** A card's placement metadata
lives in the same row as its pixels, so any metadata-only caller that reaches the
row through `idbGet('images', id)` hydrates the image as a side effect. Listing a
gallery reads a location per card, and `readImageLocation` originally used
`idbGet` — so opening a gallery decoded every image in it, one blocking base64
decode per row, exactly the cost this optimisation exists to avoid. The listing
still returned correct bytes, so nothing failed.

Two accessors exist to make the metadata path explicit, both in
`src/storage/stores.ts`: `imageLocation(id)` for one row's location and
`imageMeta(id)` for its byte count. Neither touches storage. `npm run bench`
seeds 40 images and fails if a cold listing decodes anything.

Parity cannot catch this class of bug. It diffs responses, so work spent
producing an identical response is invisible to it, and its scenario carries
three 70-byte images.

### 2b. One owner for display URLs (2.5.33)

Display URLs are multi-megabyte `data:image` strings, and there were four ways
for one image to be resident more than once:

- **Concurrent encodes.** The viewer arrow asked for its main image through
  `ensureImageUrl` while `warmVisibleImages` queued the same id, and each ran its
  own FileReader pass. `ensureBlobUrl` now keeps an in-flight map and late
  callers join the running encode (`imageUrlStats().encode_joins`).
- **Copies on the rows.** Listings attached `image_url` to every row, and the
  frozen UI copied `ensureImageUrl` results onto `card.image_url`. `t.gallery`
  rows live for the session, so every string the LRU evicted stayed alive on a
  row and the 64MB budget bounded nothing. Rows carry no `image_url` now; the
  UI's `Ie()` resolves from the cache on every paint. Parity asserts the absent
  key (`gallery.rows_carry_no_display_url`) and the build fails on a
  `card.image_url =` write.
- **Unbounded pins.** `pinImageUrls` protected the whole sticky neighbourhood
  from eviction, so a reroll-heavy message ±2 pinned more than the budget.
  `BlobUrlCache` caps the pinned set at `BLOB_URL_PIN_CAP` (24, focus-first) and
  `nearbyMessageImageIds` never returns more than that, nearest message first.
- **Whole-strip warms.** The viewer passed `max(8, strip.length)` as the warm
  window, so each arrow press re-queued the entire strip. `visibleGalleryImageIds`
  clamps to `VIEWER_WARM_WINDOW_MAX` (12) whatever the caller asks.

`npm run bench -- --route=arrows` replays a 120-step arrow sweep and fails if an
id is encoded twice, if no caller ever joins an in-flight encode, if a step warms
past the window, or if the pinned set exceeds the cap.

### 2c. SafeDOM handles are never released — so stop minting them

Every SafeElement the host hands back (`getChildren().at(i)`, `querySelectorAll`)
is registered in a strong `Map` on the Risu side until the plugin calls
`.release()`, which the frozen UI never does. The viewer's `paintThumbsQuick`
walked `getChildren()` on every arrow press to restyle thumbs in place — a path
that was dead by construction, because SafeElement throws on
`getAttribute("data-…")` (only `x-*` is readable), so every child hit
`continue` and the full repaint ran anyway. Per press that was one
`getChildren()` + N `at(i)` + N throwing `getAttribute` roundtrips, and N+1
leaked handles each pinning a detached `<img>` whose `src` was a data URL. The
build now replaces that function with the repaint alone and fails if the strip
ever calls `getChildren()` again.

The scroll tracker (`getCachedMsgEls`, one `querySelectorAll` per 450ms while
scrolling) has the same leak on live chat elements. It is **not** released yet:
its handles flow into `_nearbyMsgDomCache` and the selection state, and a
released handle throws on its next use. Measure first — `debug().main_thread`
now samples main-thread stalls — then decide.

### 3. Session index for cards

Per-session card lookups were full scans of every card in every session. A
`cardsBySession` map (`src/storage/stores.ts`) makes them direct, kept in step
through `indexCard` / `deindexCard` at the single mutation point.

### 4. Table-driven routing

1.x dispatched with a 286-line `if/else` chain over the path. 2.0 matches against
a route table (`src/api/router.ts`). The constant-factor win is small; the point
is that adding a route no longer means touching dispatch logic.

### 5. One NovelAI lane, owned by the provider

NovelAI rejects overlapping generations. 1.x guarded this with a lock shared with
the ComfyUI lane that was *stolen* after 8 s of contention — shorter than a normal
generation, so under load it did nothing.

2.0 puts the lane inside `generateT2i` (`src/providers/nai/client.ts`) and never
steals it; `naiPost`'s own wall-clock watchdog is what stops a wedged request from
holding it. Placing it in the provider rather than in `services/generation.ts`
matters: the diagnostics probe also generates images, and a lane owned by the
generation service would have left the probe unserialised, letting a connection
test collide with an image a user was waiting on.

---

## What was deliberately *not* optimised

**Settings writes.** `inx_native_settings` is now the largest single cost: 15
writes, 268 KB, one per settings mutation, each followed by a read-back to verify
it landed. That is 1.x behaviour, kept on purpose.

Settings are small, correctness-critical, and a silent failure here presents to
the user as "the plugin keeps forgetting my API key". Debouncing them would buy
little and risk exactly the data loss the read-back exists to catch. See the
header of `src/storage/settings-store.ts`.

**The `fetch` timeout.** `src/bridge/native.ts` computes one but does not enforce
it, matching 1.x. NovelAI generations legitimately run past any sane default, and
aborting them would break the feature.

---

## Consequences visible in diagnostics

Two side effects of write-behind persistence show up in the debug panel, and both
are expected rather than regressions:

- **`last_stage` may name a background flush** instead of the operation that
  caused it, because the flush now lands just *after* that operation finishes.
  The user-facing progress string uses `focus_stage || last_stage`, and
  `focus_stage` ignores background events, so nothing the user reads changes.
- **The 80-event ring buffer holds more useful history.** In 1.x storage writes
  flooded it and evicted real diagnostic stages; the same stages now survive.

`tools/parity/compare.mjs` normalises both, and each normalisation carries a
comment explaining why the value is not comparable. The stage comparison is a
*subset* check — every stage 1.x logged must still be logged — so it stays
meaningful rather than vacuous.

Since 2.5.33 the snapshot (`__INLAY_NATIVE__.debug()`) also carries three
sections a user dump can be read against, none of them behaviour:

- `boot` — a clock-derived id per module evaluation plus `prev_boot_gap_ms` from
  the persisted `inx_boot_at` stamp. An id that changes right after the settings
  button was pressed, or a gap of a few seconds, means the plugin iframe was
  reloaded — a different bug from a shell that failed to paint.
- `mem` — `js_heap_used` where the browser exposes it, the data-URL cache
  (`entries / bytes / budget / pinned / pin_cap`), explorer thumbs, PNG cache
  bytes and hydrated rows, and the encoder (`encodes / encode_joins /
  encode_inflight / warm_queue / warm_active`).
- `main_thread` — a 250ms timer that records ticks arriving ≥200ms late:
  `stalls`, `stall_max_ms`, `stall_total_ms` and the last 24 with heap size.
  The iframe shares the host's main thread, so this sees host freezes too.
