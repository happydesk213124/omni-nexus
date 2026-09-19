import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { savedFrameGuard, protectSavedFrames } from '../tools/vendor-patches/protect-saved-frames.mjs';

test('legacy whole-message cleanup preserves all three module spinners', async () => {
  const source = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  async function nxAbandonInlineFrame(wrap) {');
  const end = source.indexOf('\n  }', start) + 5;
  assert.ok(start >= 0 && end > start);
  const original = source.slice(start, end);
  const protectedBody = original.replace('if (!wrap) return;', 'if (!wrap || await nxIsSavedDisplayFrame(wrap)) return;');
  const make = body => new Function('nxDropInlineSubsForWrap', savedFrameGuard + body + ';return nxAbandonInlineFrame;')(async () => {});
  const nodes = [0, 1, 2].map(shot => ({
    removed: false,
    async getOuterHTML() { return `<div class="x-risu-omni-spinner" data-inlay-inline-shot="pending_job_${shot}" data-shot="job_${shot}" data-inray-spinner="job_${shot}"><svg></svg></div>`; },
    async remove() { this.removed = true; },
  }));
  for (const node of nodes) await make(original)(node);
  assert.equal(nodes.filter(n => n.removed).length, 3, 'old cleanup reproduces whole-slot deletion');
  for (const node of nodes) node.removed = false;
  for (const node of nodes) await make(protectedBody)(node);
  assert.equal(nodes.filter(n => n.removed).length, 0);
  const legacy = { ...nodes[0], async getOuterHTML() { return '<div x-inlay-inline-shot="old"></div>'; } };
  await make(protectedBody)(legacy);
  assert.equal(legacy.removed, true, 'actual legacy cleanup still works');
});

test('saved frame protection fails when upstream code drifts', () => {
  assert.throws(() => protectSavedFrames(''), /patch drift/);
});
