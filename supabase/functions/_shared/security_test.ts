import { readJsonObject, RequestBodyError } from './http.ts';
import { matchesScreeningDocs, screeningDocPaths } from './screening.ts';
import { hasWebhookSecret } from './webhook.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test('webhooks reject user JWTs, empty configuration and incorrect secrets', () => {
  const request = (headers: Record<string, string>) =>
    new Request('https://example.com', {
      method: 'POST',
      headers,
    });
  for (const header of ['x-push-webhook-secret', 'x-screening-webhook-secret']) {
    assert(
      !hasWebhookSecret(request({ Authorization: 'Bearer user-session' }), header, 'secret'),
      'A user session must not authorize a server webhook',
    );
    assert(!hasWebhookSecret(request({}), header, ''), 'Unconfigured webhooks must fail closed');
    assert(
      !hasWebhookSecret(request({ [header]: 'secreT' }), header, 'secret'),
      'Incorrect secret accepted',
    );
    assert(
      !hasWebhookSecret(request({ [header]: 'longer-secret' }), header, 'secret'),
      'Different length secret accepted',
    );
    assert(
      hasWebhookSecret(request({ [header]: 'secret' }), header, 'secret'),
      'Valid database webhook rejected',
    );
  }
});

Deno.test('screening documents reject foreign owners, traversal and malformed collections', () => {
  const owner = '11111111-1111-1111-1111-111111111111';
  const foreign = '22222222-2222-2222-2222-222222222222';
  for (const value of [
    null,
    {},
    'photo.jpg',
    [null],
    [1],
    Array(5).fill(`${owner}/photo.jpg`),
    [`${foreign}/photo.jpg`],
    [`${owner}-other/photo.jpg`],
    [`${owner}/../${foreign}/photo.jpg`],
    [`${owner}//photo.jpg`],
    [`${owner}/./photo.jpg`],
    [`${owner}/%2e%2e/photo.jpg`],
    [`${owner}/folder\\photo.jpg`],
    [`${owner}/photo.jpg?alias`],
    [`${owner}/photo.jpg#alias`],
    [`${owner}/photo.jpg `],
    [`${owner}/photo name.jpg`],
    [`${owner}/photo\u0000.jpg`],
    [`${owner}/`],
    [`${owner}/${'a'.repeat(1024)}`],
  ]) {
    assert(screeningDocPaths(value, owner) === null, `Accepted invalid document paths: ${value}`);
  }
  assert(screeningDocPaths([], owner)?.length === 0, 'Questionnaire-only submission rejected');
  assert(
    screeningDocPaths([`${owner}/photo.jpg`, `${owner}/folder/photo.png`], owner)?.length === 2,
    'Valid owner uploads rejected',
  );
});

Deno.test('verification cannot substitute different evidence for a submitted questionnaire', () => {
  const submitted = ['owner/front.jpg', 'owner/back.jpg'];
  assert(matchesScreeningDocs(submitted, [...submitted]), 'Unchanged documents must match');
  assert(!matchesScreeningDocs(submitted, ['owner/replacement.jpg']), 'Replacement accepted');
  assert(!matchesScreeningDocs(submitted, []), 'Removal accepted');
  assert(!matchesScreeningDocs(null, []), 'Malformed stored evidence accepted');
});

async function rejectsBody(request: Request, status: number, limit = 32): Promise<void> {
  let rejected = false;
  try {
    await readJsonObject(request, limit);
  } catch (error) {
    rejected = error instanceof RequestBodyError && error.status === status;
  }
  assert(rejected, `Expected request body rejection with status ${status}`);
}

Deno.test('JSON byte limits do not trust Content-Length or wait for the whole body', async () => {
  const variants: Record<string, string>[] = [
    {},
    { 'Content-Length': '1' },
    { 'Content-Length': '1000' },
  ];
  for (const headers of variants) {
    await rejectsBody(
      new Request('https://example.com', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: 'x'.repeat(40) }),
      }),
      413,
    );
  }
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(40));
    },
    cancel() {
      cancelled = true;
    },
  });
  await rejectsBody(new Request('https://example.com', { method: 'POST', body }), 413);
  assert(cancelled, 'Over-limit stream was not cancelled');
});

Deno.test('JSON objects are required; valid bounded objects still parse', async () => {
  for (const body of ['null', '[]', '"text"', '1', '{']) {
    await rejectsBody(new Request('https://example.com', { method: 'POST', body }), 400);
  }
  const body = await readJsonObject<{ text: string }>(
    new Request('https://example.com', {
      method: 'POST',
      body: '{"text":"hello"}',
    }),
  );
  assert(body.text === 'hello', 'Valid JSON object rejected');
});
