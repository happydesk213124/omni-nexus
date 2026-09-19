/**
 * The UI-contract globals.
 *
 * The frozen UI bundle reads four namespace objects off `globalThis` and probes
 * them method-by-method (`typeof VC?.rawMessageRole === 'function'`), so a name
 * that goes missing degrades silently instead of throwing — which is why
 * `tools/audit.mjs` diffs these against the 1.x bundle's own exports on every
 * build.
 *
 * Each namespace is spread from its module, so the module's export list *is* the
 * contract. Do not hand-maintain a list of names here.
 *
 * 1.x published ten such globals; six of those existed only so its separately
 * concatenated source files could find each other at runtime. Those are real
 * imports now, so only the four the UI actually reads remain.
 */

import * as explorerSelection from '../ui-contract/explorer-selection';
import * as loreExtra from '../domain/lore/extra';
import * as lorefilterDomain from '../domain/lore/lorefilter';
import * as stylePresetIo from '../domain/style-presets/io';
import * as llmProviders from '../providers/llm/providers';
import * as llmRoles from '../domain/llm/roles';
import * as llmForm from '../ui-contract/llm-form';
import * as embeddingProviders from '../providers/embedding/client';
import * as viewerCore from '../ui-contract/viewer-core';
import * as streamKeywords from '../domain/prompt/stream-keywords';

export function installUiContractGlobals(): void {
  Reflect.set(globalThis, '__INLAY_VIEWER_CORE__', { ...viewerCore });
  Reflect.set(globalThis, '__INLAY_STREAM_KW__', {
    parseStreamKeywords: streamKeywords.parseStreamKeywords,
    haystackHasStreamKeyword: streamKeywords.haystackHasStreamKeyword,
  });
  Reflect.set(globalThis, '__INLAY_LLM__', {
    ...llmProviders,
    ...llmRoles,
    ...llmForm,
  });
  // Embedding provider helpers for the 큐레이팅 tab (not audited vs 1.x — 2.0-only).
  Reflect.set(globalThis, '__INLAY_EMBED__', {
    EMBEDDING_PROVIDERS: embeddingProviders.EMBEDDING_PROVIDERS,
    normalizeEmbeddingProvider: embeddingProviders.normalizeEmbeddingProvider,
    defaultEndpointForEmbedding: embeddingProviders.defaultEndpointForEmbedding,
    defaultModelForEmbedding: embeddingProviders.defaultModelForEmbedding,
    embeddingModelPlaceholder: embeddingProviders.embeddingModelPlaceholder,
    shouldAutoReplaceEmbeddingEndpoint: embeddingProviders.shouldAutoReplaceEmbeddingEndpoint,
    shouldAutoReplaceEmbeddingModel: embeddingProviders.shouldAutoReplaceEmbeddingModel,
    embeddingProviderNeedsApiKey: embeddingProviders.embeddingProviderNeedsApiKey,
  });
  Reflect.set(globalThis, '__INLAY_LORE_EXTRA__', { ...loreExtra });
  Reflect.set(globalThis, '__INLAY_LORE_FILTER__', { ...lorefilterDomain });
  // Style preset card.json + Risu lorebook_export parse/export (2.0-only).
  Reflect.set(globalThis, '__INLAY_STYLE_PRESETS__', {
    parseStylePresetsFromJson: stylePresetIo.parseStylePresetsFromJson,
    toLorebookExport: stylePresetIo.toLorebookExport,
    toPresetsJson: stylePresetIo.toPresetsJson,
    splitPositiveNegative: stylePresetIo.splitPositiveNegative,
  });
  Reflect.set(globalThis, '__INLAY_EXPLORER__', { ...explorerSelection });
}
