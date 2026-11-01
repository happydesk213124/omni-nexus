/**
 * 디버그 → 백업: 「모든 설정 내보내기 (키 포함)」 / 「(키 제외)」 / 「모든 설정 불러오기」.
 * The 키 포함 file holds API keys on purpose (services/full-backup), so it is saved
 * as-is, never through the sanitizing JSON export; 키 제외 is the same file the
 * backend made without them.
 */
interface Result { ok?: boolean; json?: string; restored?: string[]; error?: { message?: string } }
interface Actions {
  request: (path: string, body?: Record<string, unknown>) => Promise<Result>;
  flush: () => Promise<void>;
  reload: () => Promise<void>;
}

function saveFile(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bindFullBackup(): void {
  const root = document.getElementById('nx-full-backup');
  const actions = Reflect.get(globalThis, '__OMNI_SETTINGS_ACTIONS__') as Actions | undefined;
  if (!root || root.dataset.bound || !actions?.request) return;
  root.dataset.bound = '1';
  const status = root.querySelector<HTMLElement>('#nx-full-backup-status')!;
  const file = root.querySelector<HTMLInputElement>('#nx-full-backup-file')!;
  const buttons = () => [...root.querySelectorAll<HTMLButtonElement>('button')];
  const run = async (message: string, work: () => Promise<string>) => {
    status.textContent = message; buttons().forEach(b => { b.disabled = true; });
    try { status.textContent = await work(); }
    catch (error) { status.textContent = String((error as Error)?.message || error); }
    finally { buttons().forEach(b => { b.disabled = false; }); }
  };
  const exporter = (keys: boolean) => () => void run('내보내는 중…', async () => {
    await actions.flush();
    const result = await actions.request(keys ? '/v1/backup/full-export' : '/v1/backup/full-export?keys=0');
    if (!result?.ok || !result.json) throw new Error(result?.error?.message || '내보내지 못했습니다.');
    saveFile(result.json, `omni-nexus-full-backup${keys ? '' : '-nokeys'}-${new Date().toISOString().slice(0, 10)}.json`);
    return keys ? '내보냈습니다. API 키가 들어 있으니 공유하지 마세요.' : 'API 키를 빼고 내보냈습니다. 불러와도 그 기기의 키는 그대로 둡니다.';
  });
  root.querySelector('#nx-full-backup-export')!.addEventListener('click', exporter(true));
  root.querySelector('#nx-full-backup-export-keyless')?.addEventListener('click', exporter(false));
  root.querySelector('#nx-full-backup-import')!.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const picked = file.files?.[0]; file.value = '';
    if (!picked) return;
    void (async () => {
      if (picked.size > 20 * 1024 * 1024) { status.textContent = '백업 파일은 20 MB 이하만 불러올 수 있습니다.'; return; }
      const json = await picked.text();
      // A file made without keys leaves this device's keys as they are: the question says which this is.
      let keyless = false;
      try { keyless = (JSON.parse(json) as { keys?: unknown })?.keys === false; } catch { /* the backend says what is wrong */ }
      if (!confirm(keyless
        ? '지금 기기의 설정을 이 파일의 설정으로 바꿉니다. 이 파일에는 API 키가 없어서, 이 기기의 키는 그대로 둡니다. 계속할까요?'
        : '지금 기기의 설정(API 키 포함)을 이 파일의 설정으로 바꿉니다. 계속할까요?')) return;
      await run('불러오는 중…', async () => {
        const result = await actions.request('/v1/backup/full-import', { json });
        if (!result?.ok) throw new Error(result?.error?.message || '불러오지 못했습니다.');
        await actions.reload();
        return `불러왔습니다: ${(result.restored || []).join(' · ') || '바뀐 것 없음'}`;
      });
    })().catch(error => { status.textContent = String((error as Error)?.message || error); });
  });
}
