import { risuHost } from '../core/host';
import { bytesToBase64Async, base64ToBytes } from '../core/util/bytes';
import { compactHash } from '../domain/tts/segment';

/**
 * BGM tracks kept on this device, so a track plays at once after a refresh
 * instead of being fetched again through Risu's nativeFetch. The device store is
 * not in the save file and is never synced; one index entry lists what is kept,
 * so nothing ever lists the whole store (that walk reads every value in it, and
 * gets slow as it grows). Least recently played go first past the limit.
 */
interface Meta { url: string; bytes: number; used: number; mime: string }
interface Row { url: string; mime: string; base64: string }
const PREFIX = 'omnisound.bgm.';
const INDEX = PREFIX + 'index';

class BgmDeviceCache {
  private api?: SafeLocalPluginStorage;
  private index: Record<string, Meta> = {};
  private ready?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private budget = 200 * 1024 * 1024;
  get bytes(): number { return Object.values(this.index).reduce((sum, row) => sum + row.bytes, 0); }
  get count(): number { return Object.keys(this.index).length; }
  private init(): Promise<void> {
    return this.ready ||= (async () => {
      const host = risuHost();
      if (!host?.getLocalPluginStorage) throw new Error('Risu 로컬 저장소를 사용할 수 없습니다.');
      this.api = await host.getLocalPluginStorage();
      const index = await this.api.getItem<Record<string, Meta>>(INDEX);
      if (index && typeof index === 'object' && !Array.isArray(index)) this.index = Object.fromEntries(Object.entries(index).filter(([, row]) => row && typeof row.url === 'string' && Number.isFinite(row.bytes) && row.bytes > 0 && Number.isFinite(row.used)));
    })().catch(error => { this.ready = undefined; throw error; });
  }
  private serial<T>(task: () => Promise<T>): Promise<T> { const result = this.tail.catch(() => {}).then(task); this.tail = result; return result; }
  /** Known without reading the store: the index is enough. */
  async has(url: string): Promise<boolean> { if (!this.budget) return false; await this.init().catch(() => {}); return this.index[compactHash(url)]?.url === url; }
  async get(url: string): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
    if (!this.budget) return null;
    await this.init();
    const key = compactHash(url), meta = this.index[key];
    if (!meta || meta.url !== url) return null;
    const row = await this.api!.getItem<Row>(PREFIX + key);
    if (!row || row.url !== url) { delete this.index[key]; return null; }
    meta.used = Date.now();
    void this.serial(() => this.api!.setItem(INDEX, this.index)).catch(() => {});
    return { bytes: base64ToBytes(row.base64).slice().buffer as ArrayBuffer, mime: row.mime || meta.mime };
  }
  async put(url: string, bytes: ArrayBuffer, mime: string): Promise<void> {
    if (!this.budget || bytes.byteLength > this.budget) return;
    await this.init();
    const base64 = await bytesToBase64Async(bytes);
    await this.serial(async () => {
      const key = compactHash(url);
      await this.api!.setItem(PREFIX + key, { url, mime, base64 });
      this.index[key] = { url, bytes: base64.length, used: Date.now(), mime };
      await this.trim();
    });
  }
  /** megabytes 0: nothing is kept on the device (and what was kept goes). */
  async configure(megabytes: number): Promise<void> {
    const next = Math.max(0, megabytes) * 1024 * 1024;
    if (next === this.budget && this.ready) return;
    this.budget = next;
    await this.init();
    await this.serial(() => this.trim());
  }
  private async trim(): Promise<void> {
    let used = this.bytes;
    for (const [key, meta] of Object.entries(this.index).sort((a, b) => a[1].used - b[1].used)) {
      if (used <= this.budget) break;
      await this.api!.removeItem(PREFIX + key);
      used -= meta.bytes; delete this.index[key];
    }
    await this.api!.setItem(INDEX, this.index);
  }
  /** Only what the index names: our keys, found without listing the store. */
  async clear(): Promise<void> {
    await this.init();
    await this.serial(async () => {
      for (const key of Object.keys(this.index)) await this.api!.removeItem(PREFIX + key);
      this.index = {};
      await this.api!.setItem(INDEX, this.index);
    });
  }
}
export const bgmDeviceCache = new BgmDeviceCache();
