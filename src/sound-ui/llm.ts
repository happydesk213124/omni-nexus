import type { SoundItem, SoundKind, SfxTerm } from '../core/sound-types';
import { soundData, saveSoundData } from '../storage/sound-store';
import { soundTags } from '../domain/sound/tags';
import { glossaryPlanMessages, listPlanMessages, parseGlossaryPlan, parseListPlan } from '../domain/llm-list-plan';
import { askLlmJson, type LlmCommand, type LlmProposal } from '../tts-ui/llm-command';
import { describeListEdit } from '../tts-ui/voice-llm';
import { esc } from '../tts-ui/common';
import { uuid } from '../core/util/text';
import { giveWords } from './glossary';

const httpsAudio = (value: string): string | null => /^https:\/\/\S+$/i.test(value.trim()) ? value.trim() : null;

/** BGM or effect list: add from pasted links, rename, refile and retag, in one request. */
export function soundLlmCommand(kind: SoundKind, refresh: () => void): LlmCommand {
  const bgm = kind === 'bgm', data = soundData();
  return {
    title: bgm ? 'BGM 목록' : '효과음 목록', source: true,
    scope: `전체 ${data[kind].length}개 · 폴더 ${data.folders[kind].length}개`,
    placeholder: bgm ? '예: 분위기별 폴더로 나눠 줘 / 태그를 BGM 태그 목록 단어로 맞춰 줘 / 붙여 넣은 링크에서 추가' : '예: 소리 종류별 폴더로 나눠 줘 / 태그에 의성어(쾅, 덜컹)를 넣어 줘 / 붙여 넣은 링크에서 추가',
    propose: async (request, source, llm) => {
      const items = soundData()[kind], folders = soundData().folders[kind];
      // BGM tags are matched against the chat model's vocabulary, so the list goes along.
      const noun = bgm ? `background music (tags should use this vocabulary: ${soundData().settings.bgmTags.join(', ')})` : 'sound effect (tags are the sound words a story writes for it, e.g. 쾅, 덜컹)';
      const plan = parseListPlan(await askLlmJson(llm, listPlanMessages(noun, 'url', 'each needs its direct https audio file url as written in the source.', items.map(item => ({ name: item.name, folder: item.folder, tags: item.tags })), folders, request, source)), items.length, folders, httpsAudio);
      const keep = (folder: string) => { if (folder && !soundData().folders[kind].includes(folder)) soundData().folders[kind].push(folder); };
      const out: LlmProposal[] = [];
      for (const edit of plan.edits) {
        const item = items[edit.index]!, before = JSON.stringify(item);
        out.push({ label: esc(describeListEdit(item.name, item.folder, edit)), stale: () => JSON.stringify(soundData()[kind].find(row => row.key === item.key)) !== before,
          apply: () => {
            const target = soundData()[kind].find(row => row.key === item.key); if (!target) return;
            if (edit.name) target.name = edit.name;
            if (edit.folder !== undefined) { keep(edit.folder); target.folder = edit.folder; }
            if (edit.tags) target.tags = soundTags(edit.tags);
          } });
      }
      for (const add of plan.adds) {
        if (items.some(item => item.url === add.id)) continue;
        const item: SoundItem = { key: uuid(), kind, name: add.name, tags: soundTags(add.tags), folder: add.folder, source: 'url', url: add.id };
        out.push({ label: esc(`추가 · ${add.name}${add.folder ? ` · 폴더 ${add.folder}` : ''}${add.tags.length ? ` · ${add.tags.join(', ')}` : ''}`),
          apply: () => { keep(item.folder); if (!soundData()[kind].some(row => row.url === item.url)) soundData()[kind].push(item); } });
      }
      return out;
    },
    commit: async () => { await saveSoundData(); refresh(); },
  };
}

/** The glossary: which words go in which effect's tile, the unknown words included. */
export function glossaryLlmCommand(refresh: () => void): LlmCommand {
  const data = soundData();
  return {
    title: '효과음 용어집', source: false,
    scope: `타일 ${data.glossary.length}개 · 미등록 ${data.unknownTerms.length}개 · 효과음 ${data.sfx.length}개`,
    placeholder: '예: 미등록 용어를 알맞은 효과음 타일에 넣어 줘 / 비슷한 의성어를 더 넣어 줘 / 잘못 들어간 말을 옮겨 줘',
    propose: async (request, _source, llm) => {
      const { sfx, glossary, unknownTerms } = soundData();
      if (!sfx.length) throw new Error('등록된 효과음이 없습니다. 효과음 목록에서 먼저 추가해 주세요.');
      const tiles = glossary.map(row => ({ effect: sfx.findIndex(item => item.key === row.sfxKey), words: row.terms }));
      const changes = parseGlossaryPlan(await askLlmJson(llm, glossaryPlanMessages(sfx.map(item => ({ name: item.name, folder: item.folder, tags: item.tags })), tiles, unknownTerms, request)), glossary.length, sfx.length);
      return changes.map(change => {
        const effect = sfx[change.effect]!, row = change.tile === null ? null : glossary[change.tile]!, before = JSON.stringify(row);
        const label = row ? `「${sfx.find(item => item.key === row.sfxKey)?.name || '효과음 없음'}」 ${row.terms.join(', ') || '(비어 있음)'} → ${effect.key !== row.sfxKey ? `「${effect.name}」 ` : ''}${change.words.join(', ')}` : `새 타일 · 「${effect.name}」 · ${change.words.join(', ')}`;
        return { label: esc(label), stale: () => !!row && JSON.stringify(soundData().glossary.find(r => r.id === row.id)) !== before,
          apply: () => {
            let target: SfxTerm | undefined = row ? soundData().glossary.find(r => r.id === row.id) : undefined;
            if (!target) { target = { id: uuid(), terms: [], sfxKey: effect.key, enabled: true }; soundData().glossary.push(target); }
            target.sfxKey = effect.key; target.terms = []; giveWords(target, change.words);
          } } satisfies LlmProposal;
      });
    },
    commit: async () => { await saveSoundData(); refresh(); },
  };
}
