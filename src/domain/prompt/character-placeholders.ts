import { joinTags } from '../../core/util/text';

/** Expand against the original order before removing any character caption. */
export function insertCharacterPlaceholders<T extends { prompt: string; uc?: string }>(main: string, neg: string, captions: T[]) {
  const inserted = new Set<number>();
  const prompt = main.replace(/@ch(\d+)@/g, (_, number: string) => {
    const index = Number(number) - 1;
    if (!captions[index]) return '';
    inserted.add(index);
    return captions[index].prompt;
  });
  return {
    main: prompt,
    neg: joinTags(neg, ...captions.filter((_, index) => inserted.has(index)).map(c => c.uc || '')),
    captions: captions.filter((_, index) => !inserted.has(index)),
  };
}
