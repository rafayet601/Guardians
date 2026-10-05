const OMIT_KEYS = new Set([
  'authorization',
  'cookie',
  'cookies',
  'setcookie',
  'headers',
  'password',
  'accesstoken',
  'refreshtoken',
  'providertoken',
  'providerrefreshtoken',
  'token',
  'tokenhash',
  'apikey',
  'clientsecret',
  'codeverifier',
  'session',
  'user',
  'requestbody',
  'requestdata',
  'body',
  'querystring',
  'httpquery',
  'urlquery',
  'urlfragment',
  'imagebase64',
  'base64',
  'iddocpaths',
  'email',
  'phone',
  'fullname',
  'addressline',
  'dob',
]);

function redactText(value: string): string {
  return (
    value
      // URL queries include auth codes, signed-document tokens and map coordinates.
      .replace(/\b(?:https?|guardians|exps?):\/\/[^\s"'<>]+/gi, (url) =>
        url.split(/[?#]/, 1)[0].replace(/^(\w+:\/\/)[^/@]+@/, '$1[Filtered]@'),
      )
      .replace(
        /((?:^|[?&#])(?:code|token_hash|access_token|refresh_token|provider_token|provider_refresh_token|token|apikey)=)[^&#\s"'<>]*/gi,
        '$1[Filtered]',
      )
      .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [Filtered]')
      .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[Filtered]')
  );
}

/** Sanitize before telemetry leaves the device, including automatically collected data. */
export function redactTelemetry<T>(value: T): T {
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number, parentKey = ''): unknown => {
    if (typeof item === 'string') return redactText(item);
    if (!item || typeof item !== 'object') return item;
    if (depth > 20 || seen.has(item)) return '[Filtered]';
    seen.add(item);
    if (item instanceof Error) {
      return {
        name: redactText(item.name),
        message: redactText(item.message),
        stack: item.stack ? redactText(item.stack) : undefined,
      };
    }
    if (Array.isArray(item)) return item.map((entry) => visit(entry, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(item)) {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (OMIT_KEYS.has(normalized)) continue;
      // Request bodies/query strings can contain arbitrary form fields, not only known names.
      if (parentKey === 'request' && ['data', 'body', 'querystring'].includes(normalized)) continue;
      out[key] = visit(entry, depth + 1, normalized);
    }
    return out;
  };
  return visit(value, 0) as T;
}
