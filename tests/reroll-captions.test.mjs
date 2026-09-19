import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRerollCharacters } from '../.test-build/reroll-captions.mjs';

const roster = [
  {
    name: '보민',
    appearance: 'pink hair, CHANGED LOOK',
    attire: 'school uniform',
    costumes: [{ name: '교복', attire: 'school uniform' }],
  },
];

describe('resolveRerollCharacters', () => {
  it('keeps illustration file prompts when the roster look changed', () => {
    const sceneChars = [
      { prompt: 'long silver hair, waving', uc: '', center_x: 0.3, center_y: 0.5 },
    ];
    const out = resolveRerollCharacters({
      comic: false,
      sceneChars,
      stored: [{ name: '보민', action: 'waving', costume: '교복' }],
      fromMeta: [],
      roster,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].prompt, 'long silver hair, waving');
    assert.ok(!out[0].prompt.includes('CHANGED LOOK'));
  });

  it('rebuilds from roster only when the file prompt is empty', () => {
    const out = resolveRerollCharacters({
      comic: false,
      sceneChars: [{ prompt: '', uc: '', center_x: 0.5, center_y: 0.5 }],
      stored: [{ name: '보민', action: 'waving', costume: '교복' }],
      fromMeta: [],
      roster,
    });
    assert.ok(out[0].prompt.includes('CHANGED LOOK'));
  });

  it('does not resolve comic slot names against the roster', () => {
    const sceneChars = [
      { prompt: 'girl, looking at viewer', uc: '', center_x: 0.2, center_y: 0.4 },
    ];
    const out = resolveRerollCharacters({
      comic: true,
      sceneChars,
      stored: [{ name: '보민', action: 'should not appear' }],
      fromMeta: [],
      roster,
    });
    assert.equal(out[0].prompt, 'girl, looking at viewer');
    assert.ok(!out[0].prompt.includes('CHANGED LOOK'));
  });

  it('uses override prompts when the form sent them', () => {
    const out = resolveRerollCharacters({
      comic: false,
      sceneChars: [{ prompt: 'file prompt', uc: '', center_x: 0.5, center_y: 0.5 }],
      stored: [],
      fromMeta: [],
      roster,
      overrideHasPrompts: true,
      overrideChars: [{ prompt: 'studio prompt', center_x: 0.1, center_y: 0.2 }],
    });
    assert.equal(out[0].prompt, 'studio prompt');
    assert.equal(out[0].center_x, 0.1);
  });
});
