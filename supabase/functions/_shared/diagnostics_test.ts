import { ProviderError, safeErrorDetails } from './diagnostics.ts';

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Unexpected diagnostic');
}

Deno.test(
  'diagnostics exclude raw messages, failing rows, URLs, tokens, and arbitrary names',
  () => {
    const privateText = 'synthetic-private-data';
    for (const error of [
      privateText,
      null,
      { message: privateText, details: privateText, hint: privateText },
      { code: privateText, name: privateText, status: privateText },
      { status: 700 },
    ])
      equal(safeErrorDetails(error), { kind: 'unknown' });
    equal(safeErrorDetails({ code: '23514', message: privateText, details: privateText }), {
      code: '23514',
    });
    equal(safeErrorDetails({ code: 'PGRST116', message: privateText }), { code: 'PGRST116' });
    equal(safeErrorDetails(new TypeError(privateText)), { kind: 'TypeError' });
    equal(safeErrorDetails(new ProviderError('Anthropic', 429)), {
      status: 429,
      kind: 'ProviderError',
    });
  },
);
