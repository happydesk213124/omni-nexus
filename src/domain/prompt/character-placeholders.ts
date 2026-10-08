import { joinTags } from '../../core/util/text';

/** Expand against the original order before removing any character caption. */
export function insertCharacterPlaceholders<T extends { prompt: string; uc?: string }>(main: string, neg: string, captions: T[], append = false) {
  const inserted = new Set<number>();
  const prompt = main.replace(/@ch(\d+)@/g, (_, number: string) => {
    const index = Number(number) - 1;
    if (!captions[index]) return '';
    inserted.add(index);
    return append ? '' : captions[index].prompt;
  });
  return {
    main: append ? joinTags(prompt, ...captions.filter((_, index) => inserted.has(index)).map(c => c.prompt)) : prompt,
    neg: joinTags(neg, ...captions.filter((_, index) => inserted.has(index)).map(c => c.uc || '')),
    captions: append ? captions.map((caption, index) => inserted.has(index) ? { ...caption, prompt: '', uc: '' } : caption) : captions.filter((_, index) => !inserted.has(index)),
  };
}
