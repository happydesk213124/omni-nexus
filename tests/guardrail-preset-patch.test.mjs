import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repairGuardrailPreset } from '../tools/vendor-patches/guardrail-preset.mjs';

test('family preset patch includes all collectors and rejects a broken collector or event seam', () => {
  const source=readFileSync('vite.config.ts','utf8');
  const patched=repairGuardrailPreset(source);
  assert.equal(patched.split('      llm_guardrail_preset:').length-1,3);
  assert.throws(()=>repairGuardrailPreset(source.replace('      llm_reverse_bar:','      renamed_reverse_bar:')),/collector needle drift/);
  assert.throws(()=>repairGuardrailPreset(source.replace('llm-json-retry|llm-reverse-bar|llm-tag-cal|preprocess','changed-list')),/change handler needle drift/);
});
