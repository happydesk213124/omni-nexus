/**
 * Canvas-backed image re-encoding.
 *
 * Every path here is optional: hosts without `createImageBitmap`, `document` or
 * `OffscreenCanvas` must still work, so each function degrades to returning the
 * input untouched rather than throwing.
 */
import { dbg } from '../debug.ts';
import {
  asU8,
  type BytesLike,
  dataUrlToArrayBuffer,
  isPngBytes,
  isWebpBytes,
  sniffImageMime,
  u8ToArrayBuffer,
} from './bytes.ts';
import { CHAR_REF_STORE_MAX_WIDTH, CHAR_REF_STORE_WEBP_QUALITY, charRefStoreSize } from './char-ref-size.ts';

interface DecodedImage {
  readonly source: ImageBitmap | HTMLImageElement;
  readonly width: number;
  readonly height: number;
  close(): void;
}

type DrawnCanvas =
  | { readonly kind: 'offscreen'; readonly canvas: OffscreenCanvas }
  | { readonly kind: 'dom'; readonly canvas: HTMLCanvasElement };

/**
 * Decodes bytes to something drawable. `allowImageElement` opts into the
 * `<img>` + object-URL path, which only the WebP encoder uses.
 */
async function decodeImage(
  src: Uint8Array,
  mime: string,
  allowImageElement: boolean,
): Promise<DecodedImage | null> {
  // `Uint8Array<ArrayBufferLike>` is not a `BlobPart` because it could in theory be
  // backed by a SharedArrayBuffer. Ours never are.
  const blob = new Blob([src as unknown as ArrayBufferView<ArrayBuffer>], { type: mime });
  let source: ImageBitmap | HTMLImageElement | null = null;
  if (typeof createImageBitmap === 'function') {
    source = await createImageBitmap(blob);
  } else if (allowImageElement && typeof document !== 'undefined') {
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const objUrl = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(objUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objUrl);
        reject(new Error('image decode failed'));
      };
      img.src = objUrl;
    });
  }
  if (!source) return null;

  const decoded = source;
  // An <img> reports 0 for width/height until it is laid out, so fall back to
  // the intrinsic size.
  const natural = 'naturalWidth' in decoded
    ? { w: decoded.naturalWidth, h: decoded.naturalHeight }
    : { w: 0, h: 0 };
  return {
    source: decoded,
    width: decoded.width || natural.w || 0,
    height: decoded.height || natural.h || 0,
    close: () => {
      try {
        // An <img> has nothing to release; only ImageBitmap does.
        if ('close' in decoded) decoded.close();
      } catch {
        // Already released.
      }
    },
  };
}

/**
 * Paints the whole image into a `w`×`h` canvas. Returns `null` when no canvas
 * flavour is reachable or the 2d context is refused.
 */
function drawToCanvas(
  image: DecodedImage,
  w: number,
  h: number,
  allowOffscreen: boolean,
): DrawnCanvas | null {
  if (allowOffscreen && typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image.source, 0, 0, w, h);
    return { kind: 'offscreen', canvas };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image.source, 0, 0, w, h);
    return { kind: 'dom', canvas };
  }
  return null;
}

/**
 * Resize a character reference for the module store: keep aspect, cap width
 * at 400, prefer webp @ 0.8. Plugin hosts often fail `toBlob('image/webp')`,
 * so this falls back to PNG then the original bytes instead of aborting.
 */
export async function encodeCharRefWebp(
  buf: BytesLike,
  quality = CHAR_REF_STORE_WEBP_QUALITY,
): Promise<ArrayBuffer> {
  const src = asU8(buf);
  if (!src.length) throw new Error('참고 이미지가 비어 있습니다');
  const q = Number.isFinite(quality) && quality > 0 && quality <= 1 ? quality : CHAR_REF_STORE_WEBP_QUALITY;
  const mime = sniffImageMime(src);
  const image = await decodeImage(src, mime, true);
  if (!image || !(image.width > 0 && image.height > 0)) {
    image?.close();
    if (isPngBytes(src) || isWebpBytes(src) || mime === 'image/jpeg') return u8ToArrayBuffer(src);
    throw new Error('참고 이미지를 디코딩하지 못했습니다');
  }
  try {
    const { w, h } = charRefStoreSize(image.width, image.height, CHAR_REF_STORE_MAX_WIDTH);
    const drawn = drawToCanvas(image, w, h, false) || drawToCanvas(image, w, h, true);
    if (!drawn) return u8ToArrayBuffer(src);
    const webp = await canvasToWebp(drawn, q);
    if (webp && isWebpBytes(asU8(webp))) {
      dbg('image.char_ref.webp', {
        message: `${w}x${h} · q${q} · ${Math.round(webp.byteLength / 1024)}KB · from ${mime}`,
        bytes: webp.byteLength,
      });
      return webp;
    }
    const png = await canvasToPng(drawn);
    if (png && isPngBytes(asU8(png))) {
      dbg('image.char_ref.png_fallback', {
        message: `${w}x${h} · ${Math.round(png.byteLength / 1024)}KB · from ${mime}`,
        bytes: png.byteLength,
      }, 'warn');
      return png;
    }
    dbg('image.char_ref.keep_original', { message: mime, bytes: src.byteLength }, 'warn');
    return u8ToArrayBuffer(src);
  } finally {
    image.close();
  }
}

/** Re-encode gallery images to WebP @ 0.9. Falls back to original. */
export async function encodeWebpQuality(
  buf: BytesLike,
  quality = 0.9,
  preserveMetadata?: (encoded: ArrayBuffer) => ArrayBuffer | Promise<ArrayBuffer>,
): Promise<ArrayBuffer | null> {
  const src = asU8(buf);
  if (!src.length) return null;
  if (isWebpBytes(src)) return preserveMetadata ? preserveMetadata(u8ToArrayBuffer(src)) : u8ToArrayBuffer(src);
  const mime = sniffImageMime(src);
  let image: DecodedImage | null = null;
  let drawn: DrawnCanvas | null = null;
  const releaseCanvas = () => {
    if (!drawn) return;
    drawn.canvas.width = 0;
    drawn.canvas.height = 0;
    drawn = null;
  };
  try {
    image = await decodeImage(src, mime, true);
    if (!image) return null;
    if (!(image.width > 0 && image.height > 0)) return null;

    drawn = drawToCanvas(image, image.width, image.height, true);
    if (!drawn) return null;
    // drawImage has copied the pixels; encoding only needs the canvas now.
    image.close();
    image = null;

    let encoded: ArrayBuffer | null;
    if (drawn.kind === 'offscreen') {
      const outBlob = await drawn.canvas.convertToBlob({ type: 'image/webp', quality });
      if (!outBlob || !outBlob.size) return null;
      encoded = await outBlob.arrayBuffer();
    } else {
      const canvas = drawn.canvas;
      encoded = null;
      try {
        const blob = await new Promise<Blob | null>(resolve => {
          if (typeof canvas.toBlob !== 'function') return resolve(null);
          canvas.toBlob(resolve, 'image/webp', quality);
        });
        if (blob?.size) {
          const bytes = await blob.arrayBuffer();
          if (isWebpBytes(asU8(bytes))) encoded = bytes;
        }
      } catch {
        // Some plugin hosts reject toBlob or return PNG for a WebP request.
      }
      if (!encoded) encoded = dataUrlToArrayBuffer(canvas.toDataURL('image/webp', quality));
    }
    // Drop full-resolution canvas storage before metadata and preview work.
    releaseCanvas();

    if (!encoded) return null;
    const out = asU8(encoded);
    if (!isWebpBytes(out)) return null;
    // Keep original if WebP somehow larger (rare).
    if (!preserveMetadata && out.length >= src.length * 0.98) return null;
    return preserveMetadata ? await preserveMetadata(encoded) : encoded;
  } catch (err) {
    dbg('image.webp.encode.fail', { message: String((err as Error)?.message || err) }, 'warn');
    return null;
  } finally {
    image?.close();
    releaseCanvas();
  }
}

/**
 * Re-encode to PNG for NovelAI endpoints that reject webp/jpeg (director /
 * Precise Reference encoding). Returns the original buffer when already PNG
 * or when canvas encode is unavailable.
 */
export async function ensurePngBytes(buf: BytesLike): Promise<ArrayBuffer> {
  const src = asU8(buf);
  if (!src.length) return u8ToArrayBuffer(src);
  if (isPngBytes(src)) return u8ToArrayBuffer(src);
  const mime = sniffImageMime(src);
  try {
    const image = await decodeImage(src, mime, true);
    if (!image || !(image.width > 0 && image.height > 0)) {
      image?.close();
      return u8ToArrayBuffer(src);
    }
    const drawn = drawToCanvas(image, image.width, image.height, true);
    if (!drawn) {
      image.close();
      return u8ToArrayBuffer(src);
    }
    let encoded: ArrayBuffer | null = null;
    if (drawn.kind === 'offscreen') {
      const outBlob = await drawn.canvas.convertToBlob({ type: 'image/png' });
      image.close();
      if (outBlob?.size) encoded = await outBlob.arrayBuffer();
    } else {
      encoded = dataUrlToArrayBuffer(drawn.canvas.toDataURL('image/png'));
      image.close();
    }
    if (encoded && isPngBytes(asU8(encoded))) return encoded;
  } catch (err) {
    dbg('image.png.encode.fail', { message: String((err as Error)?.message || err) }, 'warn');
  }
  return u8ToArrayBuffer(src);
}

/** NAI Precise Reference exact canvases (other sizes encode-400). */
const DIRECTOR_PORTRAIT = { w: 1024, h: 1536 } as const;
const DIRECTOR_LANDSCAPE = { w: 1536, h: 1024 } as const;
const DIRECTOR_SQUARE = { w: 1472, h: 1472 } as const;

/** Pick portrait / landscape / square from aspect (1:1 → square). */
function pickDirectorCanvas(srcW: number, srcH: number): { w: number; h: number } {
  const aspect = srcW / Math.max(1, srcH);
  // ~square band; otherwise taller→portrait, wider→landscape.
  if (aspect >= 0.9 && aspect <= 1.1) return DIRECTOR_SQUARE;
  if (aspect < 1) return DIRECTOR_PORTRAIT;
  return DIRECTOR_LANDSCAPE;
}

async function canvasToPng(drawn: DrawnCanvas): Promise<ArrayBuffer | null> {
  if (drawn.kind === 'offscreen') {
    try {
      const outBlob = await drawn.canvas.convertToBlob({ type: 'image/png' });
      if (!outBlob?.size) return null;
      const buf = await outBlob.arrayBuffer();
      return isPngBytes(asU8(buf)) ? buf : null;
    } catch {
      return null;
    }
  }
  const fromDataUrl = dataUrlToArrayBuffer(drawn.canvas.toDataURL('image/png'));
  if (fromDataUrl && isPngBytes(asU8(fromDataUrl))) return fromDataUrl;
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      drawn.canvas.toBlob(resolve, 'image/png');
    } catch {
      resolve(null);
    }
  });
  if (!blob?.size) return null;
  const buf = await blob.arrayBuffer();
  return isPngBytes(asU8(buf)) ? buf : null;
}

async function canvasToWebp(drawn: DrawnCanvas, quality: number): Promise<ArrayBuffer | null> {
  const q = Math.max(0.05, Math.min(1, quality));
  if (drawn.kind === 'offscreen') {
    try {
      const outBlob = await drawn.canvas.convertToBlob({ type: 'image/webp', quality: q });
      if (outBlob?.size) {
        const buf = await outBlob.arrayBuffer();
        if (isWebpBytes(asU8(buf))) return buf;
      }
    } catch {
      // Plugin hosts sometimes refuse Offscreen webp; DOM path is tried by callers.
    }
    return null;
  }
  // toDataURL is the reliable path in the plugin iframe; toBlob('image/webp')
  // often returns empty or a PNG mislabeled as webp.
  const fromDataUrl = dataUrlToArrayBuffer(drawn.canvas.toDataURL('image/webp', q));
  if (fromDataUrl && isWebpBytes(asU8(fromDataUrl))) return fromDataUrl;
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      drawn.canvas.toBlob(resolve, 'image/webp', q);
    } catch {
      resolve(null);
    }
  });
  if (!blob?.size) return null;
  const buf = await blob.arrayBuffer();
  return isWebpBytes(asU8(buf)) ? buf : null;
}

function letterboxDirector(
  drawn: DrawnCanvas,
  image: DecodedImage,
  cw: number,
  ch: number,
): void {
  const paint = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    const fit = Math.min(cw / image.width, ch / image.height);
    const dw = Math.max(1, Math.round(image.width * fit));
    const dh = Math.max(1, Math.round(image.height * fit));
    ctx.drawImage(image.source, Math.floor((cw - dw) / 2), Math.floor((ch - dh) / 2), dw, dh);
  };
  if (drawn.kind === 'offscreen') {
    const ctx = drawn.canvas.getContext('2d');
    if (ctx) paint(ctx);
  } else {
    const ctx = drawn.canvas.getContext('2d');
    if (ctx) paint(ctx);
  }
}

/**
 * Letterbox onto an NAI Precise Reference canvas and emit webp @ ~0.5.
 * Live probe: raw 1024² webp 400s; same image padded to 1472²/1024×1536/1536×1024
 * webp succeeds and stays small. Half-size canvases encode-400 — full size only.
 */
export async function prepareDirectorReferenceWebp(
  buf: BytesLike,
  quality = 0.5,
): Promise<ArrayBuffer> {
  const src = asU8(buf);
  if (!src.length) throw new Error('참고 이미지가 비어 있습니다');
  const mime = sniffImageMime(src);
  const image = await decodeImage(src, mime, true);
  if (!image || !(image.width > 0 && image.height > 0)) {
    image?.close();
    throw new Error('참고 이미지를 디코딩하지 못했습니다');
  }
  try {
    const { w: cw, h: ch } = pickDirectorCanvas(image.width, image.height);
    // DOM canvas preferred for webp encode reliability in the plugin host.
    const drawn = drawToCanvas(image, cw, ch, false) || drawToCanvas(image, cw, ch, true);
    if (!drawn) throw new Error('참고 이미지 캔버스를 만들지 못했습니다');
    letterboxDirector(drawn, image, cw, ch);
    const encoded = await canvasToWebp(drawn, Math.max(0.05, Math.min(1, quality)));
    if (!encoded || !isWebpBytes(asU8(encoded))) {
      throw new Error('참고 이미지를 webp로 인코딩하지 못했습니다');
    }
    dbg('image.director.webp', {
      message: `${cw}x${ch} · q${quality} · ${Math.round(encoded.byteLength / 1024)}KB · from ${mime}`,
      bytes: encoded.byteLength,
    });
    return encoded;
  } finally {
    image.close();
  }
}

export interface PreparedImage {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly filename: string;
}

/**
 * Vision-LLM image: downscale huge pastes, and always re-encode WebP to PNG
 * (Vertex / Anthropic / many Risu providers reject WebP). Decode failure
 * keeps the original bytes.
 */
export async function prepareAutotagImage(imageBytes: BytesLike): Promise<PreparedImage> {
  let u8 = asU8(imageBytes);
  if (!u8.length) throw new Error('image is empty');
  const maxEdge = 1536;
  const maxBytes = 1_200_000;
  const mime = sniffImageMime(u8);
  const needsShrink = u8.length > maxBytes;
  const needsPng = mime === 'image/webp' || isWebpBytes(u8);
  try {
    const image = await decodeImage(u8, mime, false);
    const tooBig = Boolean(image && (needsShrink || image.width > maxEdge || image.height > maxEdge));
    if (image && (tooBig || needsPng)) {
      const scale = tooBig ? Math.min(1, maxEdge / Math.max(image.width, image.height, 1)) : 1;
      const w = Math.max(1, Math.round(image.width * scale));
      const h = Math.max(1, Math.round(image.height * scale));
      const drawn = drawToCanvas(image, w, h, false) || drawToCanvas(image, w, h, true);
      if (drawn) {
        const png = await canvasToPng(drawn);
        if (png && isPngBytes(asU8(png))) {
          image.close();
          return { bytes: asU8(png), mime: 'image/png', filename: 'image.png' };
        }
      }
    }
    image?.close();
  } catch (err) {
    dbg('autotag.resize', { message: String((err as Error)?.message || err) }, 'warn');
  }
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  return { bytes: u8, mime, filename: `image.${ext}` };
}
