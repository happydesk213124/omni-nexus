/** Error shapes the API layer understands. */

/** Carries an HTTP status so the router can translate it without string matching. */
export interface FetchError extends Error {
  status: number;
  data: unknown;
}

export function makeFetchError(status: number, data: unknown, message?: string): FetchError {
  const detail = (data as { error?: { message?: string } } | null)?.error?.message;
  const err = new Error(message ?? detail ?? `HTTP ${status}`) as FetchError;
  err.status = status;
  err.data = data;
  return err;
}

export const isFetchError = (e: unknown): e is FetchError =>
  e instanceof Error && typeof (e as FetchError).status === 'number';

/** `{ error: { code, message } }` — the envelope the UI reads for messages. */
export const errorBody = (message: string, code = 'error'): { error: { code: string; message: string } } =>
  ({ error: { code, message } });
