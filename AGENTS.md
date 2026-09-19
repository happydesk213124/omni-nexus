# AGENTS.md — rules for changing this repo

Read [`REPOMAP.md`](REPOMAP.md) first for the structural map. This file is only the
rules. They exist because breaking any of them produces a plugin that looks fine
and silently destroys user data or stops rendering.

---

## The seven hard rules

### 1. Never edit `vendor/inlay-nexus-ui.js`
It is a 500 KB upstream Vite build with no source in this repo. Treat it as a
binary. The build verifies it is the native-bridge build and applies only the
asserted patches in `vite.config.ts` (version label, prompt-reset confirm,
`natural_base` checkbox→select, sticky thumb hide-via-0%). If you think you need
to change the UI, prefer changing what the backend returns; a new asserted
build-time patch is the exception, and it must fail the build when its needle drifts.

### 2. Never edit `dist/` — always `npm run build`
`dist/omninexus.js` is generated. Editing it means the next build silently
reverts your change, and the two get out of sync. This is the single most common
way this project has been broken before.

### 3. Never rename a storage key or the plugin id
Risu namespaces plugin storage by `//@name` (`omni-nexus`). The keys are listed
in REPOMAP §6. Changing either again orphans every existing user's settings,
gallery and character roster. There is no migration path back.

### 4. Our bundle must declare zero top-level names
We share a module scope with the frozen UI, which already declares
`style, Zt, on, ta, Kt, Jt, sn, gn`. The build wraps us in an IIFE and asserts this,
so the failure mode is a build error rather than a runtime one. Do not add a
top-level `await` (it cannot be IIFE-wrapped) and do not add CSS (the CSS runtime
would emit a top-level `const style`).

### 5. Behaviour changes must be intentional and visible
`npm run parity` diffs this backend against the 1.x backend over the whole API
surface. A diff is not automatically a bug — but an *unexplained* diff is.

Reach for the code first. Normalising a field in `tools/parity/compare.mjs` is
legitimate **only** when the value is genuinely not comparable — a wall-clock
timestamp, or something whose value depends on write-behind persistence timing —
and never merely because it is inconvenient. Every entry in that file carries a
comment justifying itself; if you cannot write that comment, you are hiding a
bug. When a diff is real and intended, keep it visible: assert the new behaviour
in `tools/parity/scenario.mjs` rather than deleting the assertion.

Prefer making an assertion *sharper* over dropping it. When the exported ZIP
differed by one byte, the fix was to decode the archive and compare the manifest
contents — which asserts more than the byte count ever did.

### 6. Prompt changes must reach the bundle
`prompts/*.txt` is embedded by `vite.config.ts`, not imported. A prompt that is
not in `PROMPT_KEYS` degrades silently to a one-line stub instead of failing.
See REPOMAP §8 — this is the subtlest way to break the plugin.

### 7. Never read image metadata through `idbGet('images', …)`
That call **hydrates the image** — it fetches and base64-decodes the pixels as a
side effect, because a card's placement metadata and its bytes share one row. Any
listing that does it per row decodes the whole gallery while still returning
perfectly correct data, so nothing looks wrong.

Use `imageLocation(id)` or `imageMeta(id)` from `src/storage/stores.ts` when you
want metadata. Reserve `idbGet` for callers that need the pixels. `npm run bench`
guards this; parity cannot, because it compares responses and not the work done to
build them.

---

## Workflow for any change

1. Find the owning module via REPOMAP §4 ("Where do I go to change…?").
2. Change it. Keep the layering in REPOMAP §4 — imports point downward only.
3. `npm test`.
4. If parity reports a diff, resolve it before moving on.
5. After a version bump (`PLUGIN_VERSION` / changelog / `HEAD_HELP`), `npm run build` and **commit locally** (include `dist/`). Do not push unless asked.
6. When they ask to put it on **main**, also fast-forward and push **nightly** to the same commit. Do not leave `origin/nightly` behind.

When you add a guard, prove it can fail. Break the thing it watches, watch it go
red, then put it back. Two of the checks in `tools/` were passing vacuously when
they were written — an empty `tests/` directory and an assertion whose `.every()`
ran over an empty array — and both looked green.

## Adding an API route

One entry in `src/api/router.ts`, one handler on the owning service, one step in
`tools/parity/scenario.mjs`. Do not add dispatch logic to the router.

## Adding a setting

1. Default in `src/config/defaults.ts`.
2. If old saved settings need upgrading, extend `src/config/schema.ts`.
3. Confirm the frozen UI actually reads it — if the UI does not know the key, the
   setting is inert. Check `docs/UI-CONTRACT.md`.

---

## Style

- TypeScript strict. Prefer a precise type over `any`; use `unknown` at I/O edges
  and narrow.
- Pure logic goes in `domain/`, I/O in `providers/` or `storage/`. Keeping domain
  pure is what makes it unit-testable without the mock host.
- Comment *why*, never *what*. If a line looks wrong but is correct, say why —
  those comments are load-bearing and several encode real upstream bugs.
- Small modules. If a file passes ~400 lines it is probably two concerns.

## Do not

- Add a localhost bridge, companion server, or `:28120` backend. Everything runs
  inside Risu. (This was an explicit design rule in 1.x and still is.)
- Use `localStorage` for images or settings — it is string-only and small. Use the
  device store in `src/storage/`.
- Reintroduce `globalThis.__INLAY_*?.fn?.() ?? fallback` patterns. In 1.x the
  concat build could not do real imports, so ~100 lines of fallbacks were
  duplicated. We have a bundler now: import it.
