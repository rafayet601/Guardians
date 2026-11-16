// Words and audiences for the pushes added with claim leases and urgent
// escalation (migration 0042). Pure, so the decisions can be tested without a
// database: what each event says, and when it no longer applies.

/** The base urgent alert's reach, and the wider ring used when nobody responds. */
export const BASE_RADIUS_M = 8000;
export const RING_RADIUS_M = 20000;

export type CaseEvent =
  | 'claim_expiring'
  | 'claim_expired'
  | 'claim_reopened'
  | 'urgent_unclaimed'
  | 'urgent_no_responder';
export const CASE_EVENTS: readonly CaseEvent[] = [
  'claim_expiring',
  'claim_expired',
  'claim_reopened',
  'urgent_unclaimed',
  'urgent_no_responder',
];

export interface PushCopy {
  title: string;
  body: string;
}

/**
 * Which urgent broadcast a trigger asked for: 1 is the base radius (also the
 * meaning of a missing step, which is what the 0029 insert trigger sends),
 * 2 is the wider ring. Anything else is a caller error.
 */
export function urgentStep(step: unknown): 1 | 2 | null {
  if (step === undefined || step === null || step === 1) return 1;
  if (step === 2) return 2;
  return null;
}

export function urgentCopy(step: 1 | 2, sightingTitle: string | null): PushCopy {
  const name = (sightingTitle ?? '').trim();
  if (step === 1) {
    return {
      title: '🚨 A cat needs urgent help nearby',
      body: name || 'Tap to help with a rescue near you.',
    };
  }
  return {
    title: '🚨 A cat still needs urgent help',
    body: name
      ? `"${name}": no one nearby has been able to respond yet. Can you?`
      : 'No one nearby has been able to respond yet. Tap to help.',
  };
}

/**
 * What to tell one person about a case, given the case as it is now. Null
 * when the moment has passed (for example the cat was claimed before the
 * "nobody has responded" message could be sent), so nothing false goes out.
 */
export function caseEventCopy(
  event: CaseEvent,
  sightingTitle: string | null,
  status: string,
): PushCopy | null {
  const name = (sightingTitle ?? '').trim();
  const cat = name ? `"${name}"` : 'the cat';
  const held = status === 'claimed' || status === 'in_rescue';
  const open = status === 'spotted';

  switch (event) {
    case 'claim_expiring':
      if (!held) return null;
      return {
        title: 'Still on this rescue?',
        body: `Your claim on ${cat} lapses in about 6 hours. Open Guardians to keep it or release it.`,
      };
    case 'claim_expired':
      return {
        title: 'Your claim has lapsed',
        body: open
          ? `${name ? cat : 'The cat'} is back on the map for another Guardian. You can claim again if you can still help.`
          : `Your claim on ${cat} lapsed because there was no update in time.`,
      };
    case 'claim_reopened':
      if (!open) return null;
      return {
        title: 'Your report is open again',
        body: `The Guardian on ${cat} did not post an update in time, so other Guardians can now step in.`,
      };
    case 'urgent_unclaimed':
      if (!open) return null;
      return {
        title: 'Urgent report unclaimed for an hour',
        body: `Nobody has claimed ${cat}. Open Guardians to help find a responder.`,
      };
    case 'urgent_no_responder':
      if (!open) return null;
      return {
        title: 'No Guardian has responded yet',
        body: `We widened the alert for ${cat} and told the Guardians team. Open Guardians to see what you can do now.`,
      };
  }
}

export const OPS_JOB_FAILED_COPY: PushCopy = {
  title: 'A Guardians background job failed',
  body: 'Open the moderation tools to check job health.',
};
