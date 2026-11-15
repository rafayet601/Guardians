const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_ATTEMPTS = 3;
const TICKET_ERRORS = new Set([
  'DeviceNotRegistered',
  'MessageTooBig',
  'MessageRateExceeded',
  'MismatchSenderId',
  'InvalidCredentials',
]);

interface TokenQuery extends PromiseLike<{
  data: { token: string }[] | null;
  error: unknown;
}> {
  eq(column: string, value: string | boolean): TokenQuery;
}

interface TokenClient {
  from(table: string): {
    select(columns: string): TokenQuery;
  };
}

/** Every targeted push honors both consent flags and scopes tokens to its recipient. */
export async function optedInPushTokens(admin: TokenClient, recipientId: string) {
  const { data, error } = await admin
    .from('device_push_tokens')
    .select('token')
    .eq('user_id', recipientId)
    .eq('push_enabled', true)
    .eq('urgent_opt_in', true);
  if (error) {
    console.error('[push] recipient lookup failed');
    return null;
  }
  return (data ?? []).map((row) => row.token);
}

interface DeliveryOptions {
  fetch?: typeof globalThis.fetch;
  wait?: (milliseconds: number) => Promise<void>;
}

/**
 * `sent` means accepted by Expo with a ticket ID, never delivered to a device.
 * Bounded retries are at-least-once: ambiguous network failures can duplicate a
 * notification. Callers must not treat this transport as an idempotent queue.
 * Provider text can include push tokens, so only fixed messages/statuses log.
 */
export async function sendExpoPush(
  messages: readonly { to: string }[],
  options: DeliveryOptions = {},
): Promise<{ sent: number; failed: number; deadTokens: string[] }> {
  const request = options.fetch ?? globalThis.fetch;
  const wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let sent = 0;
  let failed = 0;
  const deadTokens: string[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    let response: Response | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        response = await request(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status !== 429 && response.status < 500) break;
        console.error('[push] temporary Expo failure', response.status);
        await response.body?.cancel();
      } catch {
        console.error('[push] Expo request failed');
      }
      response = undefined;
      if (attempt + 1 < MAX_ATTEMPTS) await wait(500 * 2 ** attempt);
    }
    if (!response?.ok) {
      failed += chunk.length;
      if (response) {
        console.error('[push] Expo rejected request', response.status);
        await response.body?.cancel();
      }
      continue;
    }
    const payload = await response.json().catch(() => null);
    const tickets: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
    // With array requests Expo returns one ordered ticket per message. Missing
    // or malformed tickets cannot be counted as successful acceptance.
    for (let j = 0; j < chunk.length; j++) {
      const ticket = tickets[j] as
        | {
            status?: unknown;
            id?: unknown;
            details?: { error?: unknown };
          }
        | null
        | undefined;
      if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id.length > 0) {
        sent++;
      } else {
        failed++;
        const code = ticket?.details?.error;
        console.error(
          '[push] ticket rejected or missing',
          typeof code === 'string' && TICKET_ERRORS.has(code) ? code : 'unknown',
        );
        if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.push(chunk[j].to);
      }
    }
  }
  return { sent, failed, deadTokens };
}
