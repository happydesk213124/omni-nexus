import test from 'node:test';
import assert from 'node:assert/strict';
import { repairSpinnerPreview } from '../tools/vendor-patches/spinner-preview.mjs';

test('preview patch rejects missing, duplicate and reordered boundaries and drifted hooks', () => {
  const start = '  const nxSpinnerPreviews=new Map();';
  const end = '  async function paintAllMsgFans()';
  const observer = 'void omniRelease(records);if(nxSpinnerPreviews.size)void nxPaintSpinnerPreviews();';
  const dispose = 'omniFooterTargets.clear();nxSpinnerPreviews.clear();';
  const fixture = start + '\n// legacy painter\n' + end + '{}\n' + observer + '\n' + dispose;
  const result = repairSpinnerPreview(fixture);
  assert.match(result, /nxScheduleSpinnerPreviews\(\)/);
  assert.match(result, /nxDisposeSpinnerPreviews\(\)/);
  assert.doesNotMatch(result, /legacy painter/);
  for (const broken of [fixture.replace(start, ''), start + fixture, end + fixture,
    fixture.replace(observer, ''), fixture.replace(dispose, ''),
    end + start + observer + dispose]) {
    assert.throws(() => repairSpinnerPreview(broken), /drift/);
  }
});
