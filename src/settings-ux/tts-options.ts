import { loadTtsData, updateTtsSettings } from '../storage/tts-store';

export async function bindTtsExclusions(): Promise<void> {
  const input = document.getElementById('nx-tts-exclude-text') as HTMLInputElement | null;
  if (!input || input.dataset.bound) return;
  input.dataset.bound = '1';
  const data = await loadTtsData();
  if (!input.isConnected) return;
  input.value = data.settings.excludeText;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = () => {
    clearTimeout(timer); timer = undefined;
    void updateTtsSettings({ excludeText: input.value }).catch(error => {
      input.setCustomValidity(`TTS 설정 저장 실패: ${String(error)}`); input.reportValidity();
    });
  };
  input.addEventListener('input', () => { input.setCustomValidity(''); clearTimeout(timer); timer = setTimeout(save,300); });
  input.addEventListener('change',save);
}
