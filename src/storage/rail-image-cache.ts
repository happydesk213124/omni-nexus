export type RailImage = Blob | string;
type ImageReader = { readImage?: (path: string) => Promise<unknown> };

export const RAIL_IMAGE_BUDGET = 16 * 1024 * 1024;
const RAIL_IMAGE_ENTRIES = 128;

/** Cache bytes, not object URLs: evicting history must not break a mounted tile. */
export class RailImageCache {
  private readonly images = new Map<string, { image: RailImage; bytes: number }>();
  private readonly pending = new Map<string, Promise<RailImage | null>>();
  private bytes = 0;

  constructor(private readonly budget = RAIL_IMAGE_BUDGET, private readonly maxEntries = RAIL_IMAGE_ENTRIES) {}

  get(path: string): RailImage | undefined {
    const row = this.images.get(path);
    if (!row) return undefined;
    this.images.delete(path);
    this.images.set(path, row);
    return row.image;
  }

  read(host: ImageReader, path: string): Promise<RailImage | null> {
    const hit = this.get(path);
    if (hit) return Promise.resolve(hit);
    const pending = this.pending.get(path);
    if (pending) return pending;
    const task = Promise.resolve().then(async () => {
      const raw = await host.readImage?.(path);
      const image = raw instanceof Blob ? raw : raw instanceof Uint8Array
        ? new Blob([new Uint8Array(raw)]) : raw instanceof ArrayBuffer ? new Blob([raw])
          : typeof raw === 'string' && raw.startsWith('data:image/') ? raw : null;
      if (!image) return null;
      // Data URLs occupy JS string memory; blob.size already measures source bytes.
      const bytes = typeof image === 'string' ? image.length * 2 : image.size;
      if (bytes <= this.budget && this.maxEntries > 0) {
        this.images.set(path, { image, bytes });
        this.bytes += bytes;
        for (const [key, row] of this.images) {
          if (this.bytes <= this.budget && this.images.size <= this.maxEntries) break;
          this.images.delete(key);
          this.bytes -= row.bytes;
        }
      }
      return image;
    }).finally(() => this.pending.delete(path));
    this.pending.set(path, task);
    return task;
  }
}
