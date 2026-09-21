import { stripCbs } from '../core/util/text';
import { getPrompt } from './settings';

/** One editable rule set; callers own only references and response envelopes. */
export async function characterPrompt(shape: 'single' | 'batch' | 'scene' = 'batch'): Promise<string> {
  const envelope = shape === 'single'
    ? 'Return one character JSON object with name, aliases, original, gender, hair_color, hair_style, eye_color, height, age, penis_size, appearance, attire, bottoms, accessories.'
    : shape === 'batch'
      ? 'Return {"new_characters":[...]} only, including named costumes when applicable. No scenes.'
      : 'Return new or incomplete character records in new_characters alongside the requested scenes.';
  return `${stripCbs(await getPrompt('character_common'))}\n\n${envelope}`;
}
