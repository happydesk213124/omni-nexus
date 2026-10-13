import { risuHost } from '../core/host';
import { bytesToBase64Async, base64ToBytes } from '../core/util/bytes';
import { compactHash } from '../domain/tts/segment';

interface CacheMeta { signature: string; bytes: number; used: number }
interface AudioRow { signature: string; base64: string }
const PREFIX = 'omnitts.cache.';
export class TtsAudioCache {
  private api?: SafeLocalPluginStorage;
  private index: Record<string, CacheMeta> = {};
  private ready?: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private budget = 100 * 1024 * 1024;
  private memory = new Map<string, ArrayBuffer>();
  private memoryBytes = 0;
  private pending = new Map<string, { audio: ArrayBuffer; generation: number }>();
  get bytes(): number { return Object.values(this.index).reduce((sum, row) => sum + row.bytes, 0); }
  get count(): number { return Object.keys(this.index).length; }
  private init(): Promise<void> {
    return this.ready ||= (async () => {
      const host = risuHost();
      if (!host?.getLocalPluginStorage) throw new Error('Risu 로컬 캐시 저장소를 사용할 수 없습니다.');
      this.api = await host.getLocalPluginStorage();
      const index = await this.api.getItem<Record<string, CacheMeta>>(PREFIX + 'index');
      if (index && typeof index === 'object' && !Array.isArray(index)) this.index = Object.fromEntries(Object.entries(index).filter(([key,row]) => /^[a-f\d]+-[a-f\d]+$/.test(key) && row && typeof row.signature === 'string' && Number.isFinite(row.bytes) && row.bytes > 0 && Number.isFinite(row.used)));
    })().catch(error => { this.ready = undefined; throw error; });
  }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.catch(() => {}).then(task);
    this.tail = result;
    return result;
  }
  async get(signature: string): Promise<ArrayBuffer | null> {
    const warm = this.memory.get(signature) || this.pending.get(signature)?.audio;
    if (warm) {
      const meta = this.index[compactHash(signature)];
      if (meta?.signature === signature) meta.used = Date.now();
      this.remember(signature, warm); return warm;
    }
    await this.init();
    const generation = this.epoch, key = compactHash(signature), meta = this.index[key];
    if (!meta || meta.signature !== signature) return null;
    // IndexedDB reads need not queue behind unrelated slow audio writes.
    const row = await this.api!.getItem<AudioRow>(PREFIX + key);
    if (generation !== this.epoch || this.index[key] !== meta) return null;
    if (!row || row.signature !== signature) { delete this.index[key]; return null; }
    meta.used = Date.now();
    const audio = base64ToBytes(row.base64).slice().buffer as ArrayBuffer;
    this.remember(signature, audio);
    return audio;
  }
  private remember(signature: string, audio: ArrayBuffer): void {
    const previous = this.memory.get(signature);
    if (previous) { this.memoryBytes -= previous.byteLength; this.memory.delete(signature); }
    const limit = Math.min(this.budget, 8 * 1024 * 1024);
    if (audio.byteLength <= limit) { this.memory.set(signature, audio); this.memoryBytes += audio.byteLength; }
    this.trimMemory();
  }
  private trimMemory(): void {
    const limit = Math.min(this.budget, 8 * 1024 * 1024);
    for (const [key, bytes] of this.memory) {
      if (this.memoryBytes <= limit) break;
      this.memory.delete(key); this.memoryBytes -= bytes.byteLength;
    }
  }
  has(signature: string): boolean { return this.memory.has(signature) || this.pending.has(signature) || this.index[compactHash(signature)]?.signature === signature; }
  async put(signature: string, audio: ArrayBuffer, generation = this.epoch): Promise<void> {
    if (generation !== this.epoch) return;
    const pending = { audio, generation };
    this.pending.set(signature, pending);
    this.remember(signature, audio);
    try {
      await this.init();
      const base64 = await bytesToBase64Async(audio);
      await this.serial(async () => {
        if (generation !== this.epoch) return;
        const bytes = base64.length + signature.length * 2;
        if (bytes > this.budget) return;
        const key = compactHash(signature);
        await this.api!.setItem(PREFIX + key, { signature, base64 });
        if (generation !== this.epoch) return;
        this.index[key] = { signature, bytes, used: Date.now() };
        await this.trim();
      });
    } finally { if (this.pending.get(signature) === pending) this.pending.delete(signature); }
  }
  get generation(): number { return this.epoch; }
  async configure(megabytes: number): Promise<void> {
    this.budget = megabytes * 1024 * 1024;
    this.trimMemory();
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
    await this.api!.setItem(PREFIX + 'index', this.index);
  }
  async clear(): Promise<void> {
    this.epoch++;
    this.memory.clear(); this.memoryBytes = 0; this.pending.clear();
    this.index = {};
    await this.init();
    await this.serial(async () => {
      // Only our namespace: never clear another feature's storage.
      for (const key of await this.api!.keys()) if (key.startsWith(PREFIX)) await this.api!.removeItem(key);
      this.index = {};
    });
  }
}
