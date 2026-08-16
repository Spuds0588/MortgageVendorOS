/**
 * Generate a UUID v4-shaped identifier with zero dependencies.
 *
 * Prefers `crypto.randomUUID` when available (modern Node, edge runtimes) and
 * falls back to a UUID-shaped Math.random generator for environments that
 * lack it (notably Node 18, where `globalThis.crypto` is not yet exposed).
 * Ids are opaque identifiers, not security tokens, so the non-crypto fallback
 * is acceptable there.
 */
export function randomId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
