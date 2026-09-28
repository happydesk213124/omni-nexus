import { sanitizeForExport } from '../core/util/export-secrets';
import { getConfig } from './context';

export function shareableJson(value: unknown): string {
  return JSON.stringify(sanitizeForExport(value, getConfig()), null, 2);
}

/** Fail closed at the frozen UI's JSON download boundary. */
export function jsonParts(parts: unknown): string {
  if (!Array.isArray(parts) || !parts.length || !parts.every(part => typeof part === 'string')) {
    throw new Error('인증정보 검사 실패: JSON 내보내기를 중단했습니다.');
  }
  return shareableJson(JSON.parse(parts.join('')));
}
