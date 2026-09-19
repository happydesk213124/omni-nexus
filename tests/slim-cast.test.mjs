import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slimCardCharacters } from '../.test-build/slim-cast.mjs';

describe('slimCardCharacters', () => {
  it('drops baked prompt and look tags', () => {
    const slim = slimCardCharacters([
      {
        name: '보민',
        id: 'c1',
        scope: 'sess',
        prompt: 'long hair, school uniform, waving',
        uc: 'bad hands',
        appearance: 'long hair',
        attire: 'school uniform',
        costume: 'summer',
        action: 'waving',
        speech: '안녕',
        speech_lang: 'korean',
        raw: {
          name: '보민',
          action: 'waving',
          costume: 'summer',
          speech: '안녕',
          prompt: 'should drop',
        },
      },
    ]);
    assert.equal(slim.length, 1);
    assert.equal(slim[0].name, '보민');
    assert.equal(slim[0].costume, 'summer');
    assert.equal(slim[0].action, 'waving');
    assert.equal(slim[0].speech, '안녕');
    assert.equal(slim[0].prompt, undefined);
    assert.equal(slim[0].appearance, undefined);
    assert.equal(slim[0].raw.prompt, undefined);
    assert.equal(slim[0].raw.costume, 'summer');
  });
});
