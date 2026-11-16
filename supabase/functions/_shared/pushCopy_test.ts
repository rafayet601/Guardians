import {
  BASE_RADIUS_M,
  CASE_EVENTS,
  caseEventCopy,
  RING_RADIUS_M,
  urgentCopy,
  urgentStep,
} from './pushCopy.ts';

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test('a missing step is the base alert, 2 is the ring, anything else is refused', () => {
  assertEquals(urgentStep(undefined), 1);
  assertEquals(urgentStep(null), 1);
  assertEquals(urgentStep(1), 1);
  assertEquals(urgentStep(2), 2);
  assertEquals(urgentStep(3), null);
  assertEquals(urgentStep('2'), null);
  assertEquals(urgentStep(0), null);
  assertEquals(RING_RADIUS_M > BASE_RADIUS_M, true);
});

Deno.test('the ring alert says nobody nearer has responded, with or without a title', () => {
  assertEquals(urgentCopy(1, '  Tabby under the bridge ').body, 'Tabby under the bridge');
  assertEquals(urgentCopy(1, null).body, 'Tap to help with a rescue near you.');
  assertEquals(
    urgentCopy(2, 'Tabby under the bridge').body,
    '"Tabby under the bridge": no one nearby has been able to respond yet. Can you?',
  );
  assertEquals(urgentCopy(2, '').body, 'No one nearby has been able to respond yet. Tap to help.');
});

Deno.test('a case event says nothing once the moment has passed', () => {
  // The warning only makes sense while the Guardian still holds the cat.
  assertEquals(caseEventCopy('claim_expiring', 'Milo', 'claimed')?.title, 'Still on this rescue?');
  assertEquals(caseEventCopy('claim_expiring', 'Milo', 'in_rescue') !== null, true);
  assertEquals(caseEventCopy('claim_expiring', 'Milo', 'spotted'), null);
  assertEquals(caseEventCopy('claim_expiring', 'Milo', 'safe'), null);

  // "Open again" and "nobody has responded" are false once someone has claimed.
  for (const event of ['claim_reopened', 'urgent_unclaimed', 'urgent_no_responder'] as const) {
    assertEquals(caseEventCopy(event, 'Milo', 'spotted') !== null, true);
    assertEquals(caseEventCopy(event, 'Milo', 'claimed'), null);
    assertEquals(caseEventCopy(event, 'Milo', 'archived'), null);
  }
});

Deno.test('the former Guardian is always told, without inviting a claim that is gone', () => {
  const open = caseEventCopy('claim_expired', 'Milo', 'spotted');
  assertEquals(open?.body.includes('You can claim again'), true);
  const taken = caseEventCopy('claim_expired', 'Milo', 'claimed');
  assertEquals(taken?.body.includes('You can claim again'), false);
  assertEquals(taken?.body, 'Your claim on "Milo" lapsed because there was no update in time.');
});

Deno.test('every case event has words for an untitled cat', () => {
  for (const event of CASE_EVENTS) {
    const status = event === 'claim_expiring' ? 'claimed' : 'spotted';
    const copy = caseEventCopy(event, null, status);
    assertEquals(typeof copy?.title === 'string' && copy.title.length > 0, true);
    assertEquals(copy?.body.includes('""'), false);
    assertEquals(/the cat|The cat/.test(copy?.body ?? ''), true);
  }
});
