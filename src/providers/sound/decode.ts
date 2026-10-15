/**
 * Any audio the browser can play, as PCM. An OfflineAudioContext needs no user
 * gesture and is never heard; decoding resamples to its rate.
 */
export async function decodeAudio(bytes: ArrayBuffer): Promise<{ channels: Float32Array[]; sampleRate: number }> {
  const scope = globalThis as typeof globalThis & { webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Offline = typeof OfflineAudioContext === 'function' ? OfflineAudioContext : scope.webkitOfflineAudioContext;
  if (!Offline) throw new Error('이 환경에서는 오디오를 해석할 수 없습니다.');
  // decodeAudioData detaches its input; the caller's cached bytes stay usable.
  const buffer = await new Offline(1, 1, 44100).decodeAudioData(bytes.slice(0));
  return { channels: Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i)), sampleRate: buffer.sampleRate };
}
