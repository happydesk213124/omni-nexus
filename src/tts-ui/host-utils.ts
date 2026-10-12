import { risuHost } from '../core/host';
export async function safeArray<T>(array: SafeClassArray<T>): Promise<T[]> { const host = risuHost(); if (host?.unwarpSafeArray) return host.unwarpSafeArray(array); const result: T[] = []; for (let i=0, n=await array.length();i<n;i++) { const item=await array.at(i); if (item) result.push(item); } return result; }
export async function openTtsSettings(): Promise<void> { const open = Reflect.get(globalThis,'__OMNI_OPEN_TTS__'); if (typeof open !== 'function') throw new Error('플러그인 설정에서 TTS 탭을 열어 주세요.'); await open(); }
