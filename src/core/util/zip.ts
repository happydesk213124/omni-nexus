/**
 * Minimal ZIP reader for NovelAI's image response.
 *
 * NovelAI returns a single-entry ZIP whose local header is often written with
 * the streaming bit (bit 3) set and zeroed sizes, so the central directory is
 * the authoritative source and the local header is only a fallback.
 */
import { dbg } from '../debug.ts';
import { asU8, concatChunks, isPngBytes, u8ToArrayBuffer } from './bytes.ts';
import { sleep } from './async.ts';

interface ZipEntry {
  source: 'central_dir' | 'local_header';
  compMethod: number;
  compSize: number;
  uncompSize: number;
  dataStart: number;
  compData: Uint8Array;
}

/** Cheap "is the download finished?" probe used while streaming the response body. */
export function zipHasEocd(u8: Uint8Array | null | undefined): boolean {
  if (!u8 || u8.length < 22) return false;
  const start = Math.max(0, u8.length - 65536);
  for (let i = u8.length - 22; i >= start; i -= 1) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
      const commentLen = u8[i + 20] | (u8[i + 21] << 8);
      // Full EOCD record must be present (avoid false positives in compressed payload).
      if (i + 22 + commentLen <= u8.length) return true;
    }
  }
  return false;
}

/** Reads a little-endian uint16. */
export function readU16LE(u8: Uint8Array, o: number): number {
  return u8[o] | (u8[o + 1] << 8);
}

/** Reads a little-endian uint32. */
export function readU32LE(u8: Uint8Array, o: number): number {
  return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0;
}

/** Locates the end-of-central-directory record, or -1 when there is none. */
export function findZipEocdOffset(u8: Uint8Array): number {
  const start = Math.max(0, u8.length - 65536 - 22);
  for (let i = u8.length - 22; i >= start; i -= 1) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
      const commentLen = readU16LE(u8, i + 20);
      if (i + 22 + commentLen <= u8.length) return i;
    }
  }
  return -1;
}

/**
 * Describes the first entry using the central directory, or `null` if it is unusable.
 * Prefer central-directory sizes — the local header often has bit3/zero sizes, and the
 * old scan fed central-directory bytes into inflate, which hung.
 */
export function zipEntryFromCentralDir(u8: Uint8Array): ZipEntry | null {
  const eocd = findZipEocdOffset(u8);
  if (eocd < 0) return null;
  const cdOffset = readU32LE(u8, eocd + 16);
  if (cdOffset + 46 > u8.length) return null;
  if (u8[cdOffset] !== 0x50 || u8[cdOffset + 1] !== 0x4b || u8[cdOffset + 2] !== 0x01 || u8[cdOffset + 3] !== 0x02) {
    return null;
  }
  const compMethod = readU16LE(u8, cdOffset + 10);
  const compSize = readU32LE(u8, cdOffset + 20);
  const uncompSize = readU32LE(u8, cdOffset + 24);
  const localOffset = readU32LE(u8, cdOffset + 42);
  if (localOffset + 30 > u8.length) return null;
  if (u8[localOffset] !== 0x50 || u8[localOffset + 1] !== 0x4b || u8[localOffset + 2] !== 0x03 || u8[localOffset + 3] !== 0x04) {
    return null;
  }
  const localNameLen = readU16LE(u8, localOffset + 26);
  const localExtraLen = readU16LE(u8, localOffset + 28);
  const dataStart = localOffset + 30 + localNameLen + localExtraLen;
  if (dataStart + compSize > u8.length) return null;
  return {
    source: 'central_dir',
    compMethod,
    compSize,
    uncompSize,
    dataStart,
    compData: u8.subarray(dataStart, dataStart + compSize),
  };
}

/** Describes the first entry from its local header alone; throws when the payload boundary is unknowable. */
export function zipEntryFromLocalHeader(u8: Uint8Array): ZipEntry {
  const gpFlag = readU16LE(u8, 6);
  const compMethod = readU16LE(u8, 8);
  let compSize = readU32LE(u8, 18);
  const nameLen = readU16LE(u8, 26);
  const extraLen = readU16LE(u8, 28);
  const dataStart = 30 + nameLen + extraLen;
  if ((gpFlag & 0x08) !== 0 || compSize === 0) {
    // End of payload = start of data descriptor / central dir / EOCD — never use file EOF.
    let end = -1;
    for (let i = dataStart + 4; i < u8.length - 3; i += 1) {
      if (u8[i] !== 0x50 || u8[i + 1] !== 0x4b) continue;
      const sig = u8[i + 2];
      if (sig === 0x07 || sig === 0x01 || sig === 0x05) {
        end = i;
        break;
      }
    }
    if (end < 0) {
      const eocd = findZipEocdOffset(u8);
      if (eocd > dataStart) end = eocd;
    }
    if (end < 0) throw new Error('ZIP 데이터 경계를 찾지 못했습니다 (local header bit3)');
    compSize = end - dataStart;
  }
  if (dataStart + compSize > u8.length) {
    throw new Error(`ZIP 엔트리 길이 초과 (need ${dataStart + compSize}, have ${u8.length})`);
  }
  return {
    source: 'local_header',
    compMethod,
    compSize,
    uncompSize: readU32LE(u8, 22),
    dataStart,
    compData: u8.subarray(dataStart, dataStart + compSize),
  };
}

/** Inflates a raw deflate stream with progress logging and a hard 20s budget. */
export async function inflateRaw(compData: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream 미지원 — ZIP deflate를 풀 수 없습니다');
  }
  const u8 = asU8(compData);
  dbg('nai.inflate.start', { message: `${u8.length}B`, bytes: u8.length, focus: true });
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
  const reader = ds.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const outChunks: Uint8Array[] = [];
  let outTotal = 0;
  const deadline = Date.now() + 20000;

  const readerTask = (async () => {
    for (;;) {
      if (Date.now() >= deadline) throw new Error(`ZIP inflate 타임아웃 (out=${outTotal}B)`);
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      outChunks.push(value);
      outTotal += value.length;
      if (outTotal > 0 && outTotal % (512 * 1024) < value.length) {
        dbg('nai.inflate', { message: `out ${Math.round(outTotal / 1024)}KB`, bytes: outTotal, focus: true });
      }
    }
  })();

  const slice = 128 * 1024;
  for (let i = 0; i < u8.length; i += slice) {
    if (Date.now() >= deadline) {
      try {
        await writer.abort();
      } catch { /* already errored */ }
      throw new Error(`ZIP inflate write 타임아웃 (in=${i}B)`);
    }
    await writer.write(u8.subarray(i, Math.min(u8.length, i + slice)));
    if (i > 0 && i % (slice * 4) === 0) await sleep(0);
  }
  await writer.close();
  await readerTask;

  const out = concatChunks(outChunks, outTotal);
  dbg('nai.inflate.done', { bytes: outTotal, focus: true });
  return out;
}

/** Extracts the single image entry from a NovelAI ZIP response (or passes raw PNG bytes straight through). */
export async function unzipFirstEntry(content: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> {
  const u8 = asU8(content);
  dbg('nai.unzip.start', { message: `${u8.length}B`, bytes: u8.length, focus: true });
  if (isPngBytes(u8)) {
    dbg('nai.unzip', { message: 'raw PNG', bytes: u8.length, focus: true });
    return u8ToArrayBuffer(u8);
  }
  if (u8.length < 30 || u8[0] !== 0x50 || u8[1] !== 0x4b) {
    const head = Array.from(u8.subarray(0, 16))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    throw new Error(`ZIP/PNG 응답이 아닙니다 (len=${u8.length}, head=${head})`);
  }

  const entry = zipEntryFromCentralDir(u8) ?? zipEntryFromLocalHeader(u8);

  dbg('nai.unzip.entry', {
    message: `${entry.source} method=${entry.compMethod} comp=${entry.compSize}B uncomp=${entry.uncompSize || '?'}`,
    comp_method: entry.compMethod,
    bytes: entry.compSize,
    source: entry.source,
    focus: true,
  });

  // If local-header scan overshot into central dir / EOCD, clamp.
  const eocdAt = findZipEocdOffset(u8);
  if (eocdAt >= 0 && entry.dataStart + entry.compSize > eocdAt) {
    dbg('nai.unzip.clamp', {
      message: `comp ${entry.compSize} → ${eocdAt - entry.dataStart}`,
      focus: true,
    }, 'warn');
    entry.compSize = eocdAt - entry.dataStart;
    entry.compData = u8.subarray(entry.dataStart, eocdAt);
  }
  if (entry.compSize <= 0) throw new Error('ZIP 압축 페이로드가 비어 있습니다');

  if (entry.compMethod === 0) return u8ToArrayBuffer(entry.compData);
  if (entry.compMethod === 8) {
    const inflated = await inflateRaw(entry.compData);
    // RIFF/webp also possible
    if (!isPngBytes(inflated) && !(inflated[0] === 0x52 && inflated[1] === 0x49)) {
      dbg('nai.unzip', { message: 'inflated but not PNG/RIFF magic', bytes: inflated.length }, 'warn');
    }
    return u8ToArrayBuffer(inflated);
  }
  throw new Error(`지원하지 않는 ZIP 압축 방식: ${entry.compMethod}`);
}
