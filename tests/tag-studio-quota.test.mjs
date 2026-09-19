import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatStudioQuota,
  studioQuotaFillPct,
} from '../.test-build/tag-studio-quota.mjs';

describe('formatStudioQuota', () => {
  it('shows Anlas and the V5 percent from the debug quota payload', () => {
    assert.equal(
      formatStudioQuota({
        keys: [{
          family: 'v5/v4',
          suffix: 'abcd',
          ok: true,
          total: 1234,
          v5_usage: { pct: 42, label: '42%' },
        }],
      }),
      'V5/V4 …abcd  1234 Anlas · V5 42%',
    );
    assert.equal(studioQuotaFillPct({
      keys: [{ ok: true, v5_usage: { pct: 42 } }],
    }), 42);
  });

  it('explains an empty key list', () => {
    assert.equal(formatStudioQuota({ keys: [] }), '등록된 NovelAI 키가 없습니다.');
  });
});
