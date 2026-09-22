/**
 * Compiles the pure-logic modules to ESM so `tests/*.test.mjs` can import them.
 *
 * The unit tests are plain `.mjs` run by `node --test`, and the source is
 * TypeScript with extensionless imports that Node cannot resolve on its own.
 * Rather than teach Node to load TS, each module gets bundled to a
 * self-contained ESM file under `.test-build/`.
 *
 * The names on the left are the 1.x module names the tests were written
 * against, so the ported tests read the same as the originals even though the
 * code moved.
 */

import { build } from 'esbuild';
import { rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, '.test-build');

/** 1.x module name → where that logic lives in 2.0. */
const MODULES = {
  'character-placeholders': 'src/domain/prompt/character-placeholders.ts',
  'viewer-core': 'src/ui-contract/viewer-core.ts',
  'inline-chat': 'src/domain/inline-chat.ts',
  'object-util': 'src/core/util/object.ts',
  'explorer-selection': 'src/ui-contract/explorer-selection.ts',
  'gallery-zip': 'src/ui-contract/gallery-zip.ts',
  'unlink-match': 'src/domain/gallery/unlink-match.ts',
  'preview-retention': 'src/domain/gallery/preview-retention.ts',
  'roster-merge': 'src/domain/character/roster.ts',
  'character-identity': 'src/domain/character/identity.ts',
  'lore-extra': 'src/domain/lore/extra.ts',
  'lore-assemble': 'src/domain/lore/assemble.ts',
  'lore-lorefilter': 'src/domain/lore/lorefilter.ts',
  'llm-providers': 'src/providers/llm/providers.ts',
  'llm-transform': 'src/providers/llm/transform.ts',
  'llm-client': 'src/providers/llm/client.ts',
  'llm-roles': 'src/domain/llm/roles.ts',
  'llm-guardrails': 'src/domain/llm/guardrails.ts',
  'settings-schema': 'src/config/schema.ts',
  'reroll-setup': 'src/domain/prompt/reroll-setup.ts',
  'command-rewrite': 'src/domain/prompt/command-rewrite.ts',
  'command-char-edit': 'src/domain/character/command-edit.ts',
  'session-note': 'src/domain/tagging/session-note.ts',
  'session-location': 'src/domain/tagging/location.ts',
  'nai-payload': 'src/providers/nai/payload.ts',
  'nai-to-comfy': 'src/domain/prompt/nai-to-comfy.ts',
  'comfy-client': 'src/providers/comfy/client.ts',
  'stream-keywords': 'src/domain/prompt/stream-keywords.ts',
  'character-tags': 'src/domain/character/tags.ts',
  'character-focus': 'src/domain/character/focus.ts',
  'character-costume': 'src/domain/character/costume.ts',
  'character-looks': 'src/domain/character/looks-fields.ts',
  'nai-meta-prompt-tags': 'src/domain/nai-meta/prompt-tags.ts',
  'nai-meta-match': 'src/domain/nai-meta/match.ts',
  'nai-meta-from-metadata': 'src/domain/nai-meta/from-metadata.ts',
  'nai-meta-replay': 'src/domain/nai-meta/replay.ts',
  'slim-cast': 'src/domain/gallery/slim-cast.ts',
  'reroll-captions': 'src/domain/gallery/reroll-captions.ts',
  'tag-studio-peel': 'src/tag-studio/peel.ts',
  'tag-studio-model': 'src/tag-studio/model.ts',
  'tag-studio-quota': 'src/tag-studio/quota.ts',
  'tag-studio-replace-inline': 'src/tag-studio/replace-inline.ts',
  'nai-meta-aspect': 'src/domain/nai-meta/aspect.ts',
  'nai-meta-style-preset': 'src/domain/nai-meta/style-preset.ts',
  'nai-meta-stealth': 'src/domain/nai-meta/stealth.ts',
  'nai-meta-png-rgba': 'src/domain/nai-meta/png-rgba.ts',
  'nai-meta-risu-asset-list': 'src/domain/nai-meta/risu-asset-list.ts',
  'text-util': 'src/core/util/text.ts',
  'bytes-util': 'src/core/util/bytes.ts',
  'image-util': 'src/core/util/image.ts',
  'blob-url-cache': 'src/storage/blob-url-cache.ts',
  'explorer-thumbs': 'src/storage/explorer-thumbs.ts',
  'image-url-subs': 'src/storage/image-url-subs.ts',
  'prompt-codec': 'src/config/prompt-codec.ts',
  'style-preset-overrides': 'src/domain/style-preset-overrides.ts',
  'nai-routing': 'src/domain/nai/routing.ts',
  'nai-connection-probe': 'src/domain/nai/connection-probe.ts',
  'nai-samplers': 'src/domain/nai/samplers.ts',
  'nai-keys': 'src/domain/nai/keys.ts',
  'nai-quota': 'src/domain/nai/quota.ts',
  'nai-coords': 'src/domain/nai/coords.ts',
  'nai-speech': 'src/domain/nai/speech.ts',
  'nai-action-tags': 'src/domain/nai/action-tags.ts',
  'char-ref-keys': 'src/core/constants.ts',
  'char-ref-store': 'src/domain/character/char-ref-store.ts',
  'char-ref-seed': 'src/domain/character/char-ref-seed.ts',
  'char-ref-module': 'src/services/char-ref-module.ts',
  'shot-assets': 'src/domain/gallery/shot-assets.ts',
  'cast-ids': 'src/domain/gallery/cast-ids.ts',
  'shot-module': 'src/storage/shot-module.ts',
  stores: 'src/storage/stores.ts',
  // One bundle per name means one *copy* of every module inside it, so a test
  // that mixes two bundles gets two independent copies of the in-memory stores
  // and cannot reset the one the code under test is using. An array here
  // re-exports several modules into a single bundle to keep that state shared.
  'storage-migrate': [
    'src/services/storage-migrate.ts',
    'src/storage/stores.ts',
    'src/storage/device-store.ts',
  ],
  // Needs the same store copy it encodes from, so the test can seed real bytes.
  'image-urls': ['src/storage/image-urls.ts', 'src/storage/stores.ts'],
  'chat-chrome': 'src/services/chat-chrome.ts',
  'style-preset-io': 'src/domain/style-presets/io.ts',
  'preset-look-prompt': 'src/domain/style-presets/look-prompt.ts',
  'embedding-client': 'src/providers/embedding/client.ts',
  'shot-line': 'src/domain/tagging/shot-line.ts',
  'chat-bake': 'src/domain/chat-bake.ts',
  tts: 'src/services/tts.ts',
  'inray-display': 'src/domain/inray-display.ts',
  'comic-kind': 'src/domain/comic/kind.ts',
  'comic-llm-prose': 'src/domain/comic/llm-prose.ts',
  'comic-schedule': 'src/domain/comic/schedule.ts',
  'comic-coords': 'src/domain/comic/coords.ts',
  'comic-costume': 'src/domain/comic/costume.ts',
  'comic-page': 'src/domain/comic/page.ts',
  'comic-natural': 'src/domain/comic/natural.ts',
  'comic-tags': 'src/domain/comic/tags.ts',
  'comic-caption': 'src/domain/comic/caption.ts',
  'comic-params': 'src/domain/comic/params.ts',
  'comic-aspect': 'src/domain/comic/aspect.ts',
  'tagger-char-user': 'src/domain/tagging/char-user-info.ts',
  'job-retention': 'src/domain/jobs/retention.ts',
  debug: 'src/core/debug.ts',
};

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

/** Several modules in one bundle: a virtual entry that re-exports each. */
const barrelFor = (entries) => ({
  stdin: {
    contents: entries.map((e) => `export * from ${JSON.stringify(`./${e}`)};`).join('\n'),
    resolveDir: root,
    sourcefile: 'test-barrel.ts',
    loader: 'ts',
  },
});

await Promise.all(
  Object.entries(MODULES).map(([name, entry]) =>
    build({
      absWorkingDir: root,
      ...(Array.isArray(entry) ? barrelFor(entry) : { entryPoints: [entry] }),
      outfile: path.join(outdir, `${name}.mjs`),
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      // Keep names so assertions on `fn.name` and error messages stay readable.
      keepNames: true,
      logLevel: 'warning',
    }),
  ),
);

console.log(`[build-tests] ${Object.keys(MODULES).length} modules -> .test-build/`);
