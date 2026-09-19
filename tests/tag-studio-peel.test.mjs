import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  peelMain,
  peelPreset,
  peelStudioCharFields,
  resolveCharPost,
} from '../.test-build/tag-studio-peel.mjs';

const presets = [
  { id: 'short', name: '짧은', positive: 'best quality', negative: 'lowres' },
  {
    id: 'long',
    name: '긴',
    positive: 'best quality, very aesthetic, highres',
    negative: 'lowres, logo',
  },
];

describe('tag-studio peel', () => {
  it('picks the longest preset blob that appears as a whole substring', () => {
    const hit = peelPreset(
      '1girl, best quality, very aesthetic, highres, classroom, sitting',
      presets,
    );
    assert.equal(hit.id, 'long');
    assert.match(hit.rest, /classroom/);
    assert.match(hit.rest, /sitting/);
    assert.ok(!hit.rest.includes('very aesthetic'));
  });

  it('leaves 선행 empty when no preset matches', () => {
    const hit = peelPreset('classroom, sitting', presets);
    assert.equal(hit.id, '');
    assert.equal(hit.rest, 'classroom, sitting');
  });

  it('peels person-count and quality from the front of main', () => {
    const peeled = peelMain(
      '1girl, best quality, very aesthetic, highres, classroom',
      presets,
    );
    assert.equal(peeled.preset.id, 'long');
    assert.equal(peeled.person, '1girl');
    assert.equal(peeled.post, 'classroom');
  });

  it('keeps the speechbubble tail on C 후행 so studio can edit it', () => {
    assert.equal(
      resolveCharPost({
        slim: { action: 'waving', expression: 'smile' },
        caption: 'long silver hair, waving, smile, speechbubble, korean text:안돼, 가지마',
        lookTags: 'long silver hair',
      }),
      'waving, smile, speechbubble, korean text:안돼, 가지마',
    );
  });

  it('uses slim shot fields for C 후행 when present', () => {
    assert.equal(
      resolveCharPost({
        slim: { action: 'waving', expression: 'smile' },
        caption: 'long silver hair, school uniform, waving, smile',
        lookTags: 'long silver hair, school uniform',
      }),
      'waving, smile',
    );
  });

  it('falls back to caption minus look when slim 후행 is empty', () => {
    assert.equal(
      resolveCharPost({
        slim: {},
        caption: 'long silver hair, school uniform, waving, blush',
        lookTags: 'long silver hair, school uniform',
      }),
      'waving, blush',
    );
  });

  it('puts the whole caption in 후행 when there is no look', () => {
    assert.equal(
      resolveCharPost({
        slim: {},
        caption: 'girl, looking at viewer',
        lookTags: '',
      }),
      'girl, looking at viewer',
    );
  });

  it('splits a baked caption into 외형 / 코스튬 / 후행 without dumping the roster', () => {
    const peeled = peelStudioCharFields({
      slim: { action: 'waving', expression: 'smile' },
      caption: 'long silver hair, blue eyes, school uniform, blue tie, waving, smile',
      lookTags: 'long silver hair, blue eyes, extra roster only, school uniform, blue tie',
      costumeAttire: 'school uniform, blue tie',
    });
    assert.equal(peeled.tags, 'long silver hair, blue eyes');
    assert.equal(peeled.costumeTags, 'school uniform, blue tie');
    assert.equal(peeled.post, 'waving, smile');
  });

  it('moves clothes into 코스튬 even when roster attire is empty', () => {
    const peeled = peelStudioCharFields({
      slim: { action: 'sitting' },
      caption: 'black hair, brown eyes, hoodie, jeans, sitting',
      lookTags: 'black hair, brown eyes, hoodie, jeans',
      costumeAttire: '',
    });
    assert.equal(peeled.tags, 'black hair, brown eyes');
    assert.equal(peeled.costumeTags, 'hoodie, jeans');
    assert.equal(peeled.post, 'sitting');
  });
});
