import { risuHost } from '../core/host';

const KEY = 'omnitts.translations';
export class TtsTranslationCache {
  private entries = new Map<string, string>();
  private ready?: Promise<void>;
  private api?: SafeLocalPluginStorage;
  private tail: Promise<unknown> = Promise.resolve();
  async init(): Promise<void> {
    return this.ready ||= (async () => {
      this.api = await risuHost()?.getLocalPluginStorage?.();
      if (!this.api) return;
      const raw: unknown = await this.api.getItem(KEY);
      if (Array.isArray(raw)) for (const row of raw.slice(-2000)) if (Array.isArray(row) && typeof row[0] === 'string' && typeof row[1] === 'string') this.entries.set(row[0], row[1]);
    })();
  }
  get(key: string): string | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) { this.entries.delete(key); this.entries.set(key, value); }
    return value;
  }
  put(key: string, value: string): void { this.entries.set(key, value); }
  async flush(): Promise<void> {
    let bytes = [...this.entries].reduce((n, [k, v]) => n + 2 * (k.length + v.length), 0);
    for (const [k, v] of this.entries) {
      if (bytes <= 5 * 1024 * 1024 && this.entries.size <= 2000) break;
      bytes -= 2 * (k.length + v.length); this.entries.delete(k);
    }
    const snapshot = [...this.entries];
    const result = this.tail.catch(() => {}).then(() => this.api?.setItem(KEY, snapshot));
    this.tail = result;
    await result;
  }
  async clear(): Promise<void> { this.entries.clear(); await this.flush(); }
}
