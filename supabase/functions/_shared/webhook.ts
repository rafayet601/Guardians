import { timingSafeEqual } from 'node:crypto';

/** Fail closed: user JWTs are never a substitute for a server webhook secret. */
export function hasWebhookSecret(req: Request, header: string, secret: string): boolean {
  const presented = req.headers.get(header) ?? '';
  if (!secret || !presented) return false;
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(secret);
  const presentedBytes = encoder.encode(presented);
  return (
    expectedBytes.length === presentedBytes.length && timingSafeEqual(expectedBytes, presentedBytes)
  );
}
