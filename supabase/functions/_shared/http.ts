/** Browser access for bearer-authenticated Edge Functions. Auth stays in each handler. */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS'
    ? new Response(null, { status: 204, headers: corsHeaders })
    : null;
}

export class RequestBodyError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
  }
}

// A 5 MiB image expands to about 7 MiB in base64; allow a small JSON envelope.
export const MAX_IMAGE_REQUEST_BYTES = Math.ceil((5 * 1024 * 1024) / 3) * 4 + 16 * 1024;

/** Bound bytes before decoding JSON, even when Content-Length is absent or false. */
export async function readJsonObject<T extends object>(
  req: Request,
  maxBytes = 16 * 1024,
): Promise<T> {
  const tooLarge = () => new RequestBodyError('Request body too large', 413);
  if (Number(req.headers.get('Content-Length')) > maxBytes) {
    await req.body?.cancel();
    throw tooLarge();
  }
  if (!req.body) throw new RequestBodyError('Invalid JSON object');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestBodyError('Invalid JSON object');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RequestBodyError('Invalid JSON object');
  }
  return parsed as T;
}
