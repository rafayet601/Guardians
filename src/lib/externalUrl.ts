/** Curated content may open a web page, never an app command or script URL. */
export function externalWebUrl(value: string | null | undefined): string | null {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname) return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
