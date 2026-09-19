# Omni Nexus

A RisuAI plugin that turns chat prose into images. It watches messages, asks an
LLM to describe them as Danbooru-style tags, generates the images through NovelAI
or ComfyUI, and overlays them inline in the chat.

This is a full rewrite of Inlay Nexus 1.3 with identical behaviour — verified
step-by-step against the old implementation — and substantially less disk I/O.

| | 1.x | 2.0 |
|---|---|---|
| Backend source | 9.2k lines, 7.1k in one file | 12.7k lines, 51 modules |
| Build | 1,145-line concatenation script | `vite.config.ts` |
| Storage writes (118-step scenario) | 147 | 44 |
| Bytes written | 1,732 KB | 405 KB |
| Tests | 100 unit | the same 100, plus a 118-step parity diff and a bundle audit |

See [`docs/OPTIMIZATIONS.md`](docs/OPTIMIZATIONS.md) for how that was measured.

## Install

```bash
npm install
npm run build      # writes dist/omninexus.js
```

In RisuAI, open plugin import and select `dist/omninexus.js`. Updates come from
`https://raw.githubusercontent.com/happydesk213124/omni-nexus/main/dist/omninexus.js`.
The plugin is a single self-contained file; it opens no network connection of its
own beyond the image and LLM APIs you configure.

## Working on it

**Start with [`REPOMAP.md`](REPOMAP.md)** — it maps "where do I go to change X?"
onto the module that owns it. [`AGENTS.md`](AGENTS.md) has the rules that keep a
change from silently destroying user data; read it before your first edit.

```bash
npm test           # typecheck → unit → build → audit → smoke → bench → parity
```

Each stage answers a different question, and all seven are fast (~25 s total):

| Stage | Question it answers |
|---|---|
| `typecheck` | Does it compile? |
| `unit` | Do the pure modules still behave? (1.x's 100 tests, unchanged but for import paths) |
| `build` | Does it produce a loadable plugin? |
| `audit` | Is the bundle *shaped* right — UI globals, prompts, IIFE, layering, doc links? |
| `smoke` | Does the built file actually boot and serve requests? |
| `bench` | Does listing a gallery still avoid decoding every image? |
| `parity` | Does it behave identically to 1.x across the whole API surface? |

`parity` is the one that matters. It boots the 1.x backend and this one against a
single deterministic mock Risu host, replays 118 steps over every route and bridge
method, and diffs the results. A clean run means no observable behaviour changed.

`bench` covers parity's blind spot. Parity compares *responses*, so a change that
keeps every byte identical while decoding the whole gallery to produce them passes
it — and its scenario holds three 70-byte images, too few to notice. `bench` seeds
40 and asserts the listing answers from the index alone.

## Layout

```
src/          the backend, layered: bridge → api → services → domain → providers → storage → core
vendor/       the UI bundle — FROZEN, no source in this repo, never edit
prompts/      LLM prompt pack, embedded at build time (see REPOMAP §8)
reference/    1.x sources, read-only, used by the audit and parity harness
docs/         UI contract, service contracts, optimization notes
tools/        audit, parity harness, test compiler
tests/        unit tests for the pure modules
```

The UI half is a 503 KB upstream Vite build whose source this repo does not have.
That single fact drives most of the architecture: the backend's job is to satisfy
a fixed contract ([`docs/UI-CONTRACT.md`](docs/UI-CONTRACT.md)), and it may change
*how* it answers but never *what* it answers.

## License

MIT
