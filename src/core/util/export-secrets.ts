/** Export-only filtering: never run this over persisted settings or API requests. */
const SECRET_FIELD = /^(?:.*apikeys?(?:v\d+)?|serviceaccount(?:json|key)?|privatekey(?:id)?|auth(?:orization|token)?|accesstoken|refreshtoken|idtoken|bearertoken|password|passwd|secret|clientsecret|credentials?|credentialjson)$/;
export function isCredentialField(name: string): boolean {
  return SECRET_FIELD.test(name.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

const REDACTED = '[인증정보 제거됨]';
const ADDRESS_REMOVED = '[주소 제거됨]';
/**
 * The address of a server of the user's own: a Tailscale name or address (*.ts.net, 100.64.0.0/10), a home network
 * one (10/8, 172.16/12, 192.168/16, *.local, *.lan). A shared file carrying one tells the reader the device's name
 * and tailnet. localhost stays: it names nobody, and it is the default a file is expected to hold.
 */
const PRIVATE_URL = /\bhttps?:\/\/(?:[a-z0-9-]+\.)*(?:[a-z0-9-]+\.ts\.net|[a-z0-9-]+\.(?:local|lan)|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2})(?::\d{1,5})?(?:\/[^\s"'<>]*)?/gi;
/** A field that is such an address and nothing else is emptied; inside other text the address alone is taken out. */
export function withoutPrivateAddresses(text: string): string {
  const hits = text.match(PRIVATE_URL);
  if (!hits) return text;
  return hits.length === 1 && hits[0] === text.trim() ? '' : text.replace(PRIVATE_URL, ADDRESS_REMOVED);
}

/** Also removes saved credentials accidentally pasted into notes or other free text. */
export function sanitizeForExport(value: unknown, credentials?: unknown): unknown {
  const secrets = new Set<string>();
  function collect(node: unknown, sensitive = false): void {
    if (typeof node === 'string') {
      if (sensitive && node.length >= 8) secrets.add(node);
      if (/^\s*[\[{]/.test(node)) {
        try { collect(JSON.parse(node)); } catch { /* ordinary prompt text */ }
      }
    } else if (Array.isArray(node)) {
      for (const child of node) collect(child, sensitive);
    } else if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) collect(child, sensitive || isCredentialField(key));
    }
  }
  collect(credentials);
  collect(value);
  // Longest first so a token which is a prefix of another cannot expose its suffix.
  const known = [...secrets].sort((a, b) => b.length - a.length);
  function scrub(text: string): string {
    for (const secret of known) {
      text = text.split(secret).join(REDACTED);
      const escaped = JSON.stringify(secret).slice(1, -1);
      if (escaped !== secret) text = text.split(escaped).join(REDACTED);
    }
    return text
      .replace(/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )*PRIVATE KEY-----|$)/g, REDACTED)
      .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, REDACTED)
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer ' + REDACTED)
      .replace(/([?&](?:api[_-]?key|key|token|access_token|auth|secret|password)=)[^&#\s"']+/gi, '$1' + REDACTED)
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1' + REDACTED + '@');
  }
  function visit(node: unknown): unknown {
    if (typeof node === 'string') {
      if (/^\s*[\[{]/.test(node)) {
        try {
          const parsed: unknown = JSON.parse(node);
          const safe = visit(parsed);
          // Keep normal prompt formatting intact when no credential was present.
          if (JSON.stringify(safe) !== JSON.stringify(parsed)) return JSON.stringify(safe);
        } catch { /* ordinary prompt text */ }
      }
      return withoutPrivateAddresses(scrub(node));
    }
    if (Array.isArray(node)) return node.map(visit);
    if (!node || typeof node !== 'object') return node;
    return Object.fromEntries(Object.entries(node).filter(([key]) => !isCredentialField(key)).map(([key, child]) => [scrub(key), visit(child)]));
  }
  return visit(value);
}

/** Sharing a file must not replace the recipient's connection credentials. `secret`: which fields hold them. */
export function retainLocalCredentials(next: unknown, previous: unknown, secret: (name: string) => boolean = isCredentialField): void {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return;
  if (!previous || typeof previous !== 'object' || Array.isArray(previous)) return;
  const target = next as Record<string, unknown>;
  const source = previous as Record<string, unknown>;
  for (const key of new Set([...Object.keys(target), ...Object.keys(source)])) {
    if (secret(key)) {
      if (Object.hasOwn(source, key)) target[key] = JSON.parse(JSON.stringify(source[key] ?? null));
      else delete target[key];
    } else retainLocalCredentials(target[key], source[key], secret);
  }
}
