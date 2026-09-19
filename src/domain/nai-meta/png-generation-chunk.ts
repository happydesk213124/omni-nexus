/** Private ancillary, safe-to-copy PNG chunk (reserved third letter uppercase). */
export const PNG_GENERATION_CHUNK = 'onXd';
export function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function pngChunks(bytes: Uint8Array): Array<{ name: string; start: number; end: number; data: Uint8Array }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const result = [];
  let start = 8;
  while (start < bytes.length) {
    if (start + 12 > bytes.length) throw new Error('Truncated PNG chunk');
    const size = view.getUint32(start);
    const end = start + size + 12;
    if (end > bytes.length) throw new Error('Truncated PNG payload');
    const name = String.fromCharCode(...bytes.subarray(start + 4, start + 8));
    if (name === PNG_GENERATION_CHUNK && pngCrc(bytes.subarray(start + 4, end - 4)) !== view.getUint32(end - 4)) {
      throw new Error('Generation PNG CRC mismatch');
    }
    result.push({ name, start, end, data: bytes.subarray(start + 8, end - 4) });
    start = end;
    if (name === 'IEND') break;
  }
  if (result[0]?.name !== 'IHDR' || result.at(-1)?.name !== 'IEND' || start !== bytes.length) throw new Error('Invalid PNG structure');
  return result;
}
export function writePngGenerationChunk(src: Uint8Array, body: Uint8Array): Uint8Array {
  const keep = pngChunks(src).filter(c => c.name !== PNG_GENERATION_CHUNK);
  const chunk = new Uint8Array(body.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(new TextEncoder().encode(PNG_GENERATION_CHUNK), 4);
  chunk.set(body, 8);
  view.setUint32(chunk.length - 4, pngCrc(chunk.subarray(4, chunk.length - 4)));
  const out = new Uint8Array(8 + keep.reduce((n, c) => n + c.end - c.start, 0) + chunk.length);
  out.set(src.subarray(0, 8));
  let offset = 8;
  for (const c of keep) {
    if (c.name === 'IEND') { out.set(chunk, offset); offset += chunk.length; }
    out.set(src.subarray(c.start, c.end), offset); offset += c.end - c.start;
  }
  return out;
}
