import { ttsData } from '../storage/tts-store';
import { fishVoiceId, parseVoiceImport, voiceGender } from '../domain/tts/library';
import { listPlanMessages, parseListPlan, type ListEdit } from '../domain/llm-list-plan';
import { askLlmJson, type LlmCommand, type LlmProposal } from './llm-command';
import { esc, persist } from './common';

/** One line for a proposed edit: what changes on which item. */
export function describeListEdit(name: string, folder: string, edit: ListEdit): string {
  return [`수정 · ${name}`, edit.name && edit.name !== name ? `이름 → ${edit.name}` : '', edit.folder !== undefined && edit.folder !== folder ? `폴더 → ${edit.folder || '미분류'}` : '', edit.tags ? `태그 → ${edit.tags.join(', ') || '없음'}` : ''].filter(Boolean).join(' · ');
}

/** The voice list's 「LLM에게 시키기」: add from pasted source and rename, refile and retag, in one request. */
export function voiceLlmCommand(refresh: () => void): LlmCommand {
  const data = ttsData();
  return {
    title: '음성 목록', source: true,
    scope: `전체 ${data.voices.length}개 음성 · 폴더 ${data.folders.length}개`,
    placeholder: '예: 성별·나이대별 폴더로 나눠 줘 / 이름을 「캐릭터 (작품)」 형식으로 / 붙여 넣은 목록에서 추가',
    propose: async (request, source, llm) => {
      const voices = ttsData().voices, folders = ttsData().folders;
      const plan = parseListPlan(await askLlmJson(llm, listPlanMessages('TTS voice', 'fishId', 'each needs its explicit 32-character Fish voice id (fishId) as written in the source.', voices.map(v => ({ name: v.name, folder: v.folder || '', tags: v.tags })), folders, request, source)), voices.length, folders, value => fishVoiceId(value) || null);
      const keep = (folder: string) => { if (folder && !ttsData().folders.includes(folder)) ttsData().folders.push(folder); };
      const out: LlmProposal[] = [];
      for (const edit of plan.edits) {
        const voice = voices[edit.index]!, before = JSON.stringify(voice);
        out.push({ label: esc(describeListEdit(voice.name, voice.folder || '', edit)), stale: () => JSON.stringify(ttsData().voices.find(v => v.key === voice.key)) !== before,
          apply: () => {
            const target = ttsData().voices.find(v => v.key === voice.key); if (!target) return;
            if (edit.name) target.name = edit.name;
            if (edit.folder !== undefined) { keep(edit.folder); target.folder = edit.folder; }
            if (edit.tags) { target.tags = edit.tags; target.gender = voiceGender(edit.tags); }
          } });
      }
      for (const add of plan.adds) {
        if (voices.some(v => v.fishId === add.id)) continue;
        const voice = parseVoiceImport({ voices: [{ name: add.name, fishId: add.id, tags: add.tags }] })[0]; if (!voice) continue;
        voice.folder = add.folder;
        out.push({ label: esc(`추가 · ${add.name}${add.folder ? ` · 폴더 ${add.folder}` : ''}${add.tags.length ? ` · ${add.tags.join(', ')}` : ''}`),
          apply: () => { keep(voice.folder); if (!ttsData().voices.some(v => v.fishId === voice.fishId)) ttsData().voices.push(voice); } });
      }
      return out;
    },
    commit: async () => { await persist(); refresh(); },
  };
}
