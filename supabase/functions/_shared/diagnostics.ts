/** Error messages/rows can contain personal input, tokens, or signed URLs. */
export function safeErrorDetails(error: unknown): Record<string, string | number> {
  if (!error || typeof error !== 'object') return { kind: 'unknown' };
  const value = error as { code?: unknown; status?: unknown; name?: unknown };
  const details: Record<string, string | number> = {};
  // Database/PostgREST error codes are diagnostic identifiers, never messages.
  if (
    typeof value.code === 'string' &&
    /^(?:[0-9]{2}[0-9A-Z]{3}|PGRST[0-9]{3})$/.test(value.code)
  ) {
    details.code = value.code;
  }
  if (
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599
  )
    details.status = value.status;
  if (
    typeof value.name === 'string' &&
    [
      'Error',
      'TypeError',
      'SyntaxError',
      'AbortError',
      'TimeoutError',
      'AuthApiError',
      'RequestBodyError',
      'ProviderError',
    ].includes(value.name)
  )
    details.kind = value.name;
  return Object.keys(details).length ? details : { kind: 'unknown' };
}

/** Preserve the HTTP status for diagnostics while excluding response bodies. */
export class ProviderError extends Error {
  constructor(
    provider: 'Anthropic' | 'Voyage',
    readonly status: number,
  ) {
    super(`${provider} API error ${status}`);
    this.name = 'ProviderError';
  }
}
