import type { AdoptionInterest, Sighting } from '@/types/models';

type CaseSummary = Pick<Sighting, 'status' | 'reporter_id' | 'claimed_by' | 'claimer'>;

interface GuidanceOptions {
  /** A claimed rescue with no activity for CLAIM_STALE_HOURS. */
  claimStale?: boolean;
}

/** Copy reflects the existing lifecycle; it never grants permission to change it. */
export function getSightingGuidance(
  sighting: CaseSummary,
  userId?: string,
  { claimStale = false }: GuidanceOptions = {},
) {
  const isClaimer = !!userId && userId === sighting.claimed_by;
  const isOwner = !!userId && userId === sighting.reporter_id;
  const canManage = isClaimer || isOwner;
  const responsibility = sighting.claimed_by
    ? isClaimer
      ? 'You are the assigned guardian'
      : `${sighting.claimer?.username || 'A guardian'} is assigned`
    : 'No guardian assigned';

  switch (sighting.status) {
    case 'spotted':
      return {
        responsibility,
        nextStep: isOwner
          ? 'Add a comment if you have new information about the cat. Close the report if the cat has been found or has moved on.'
          : 'Claim this rescue when you can take responsibility. Add a comment if you have a new sighting or useful information.',
      };
    case 'claimed':
      return {
        responsibility,
        nextStep: isClaimer
          ? claimStale
            ? 'It has been a while since the last update. Post where things stand, mark the rescue in progress, or release it so another Guardian can help.'
            : "Share your plan in Activity. Mark the rescue in progress when it begins, or release it if you can't make it."
          : canManage
            ? claimStale
              ? 'The Guardian has not posted for over a day. Ask in Activity, or reopen this report so someone else can help. Mark the rescue in progress when it begins.'
              : 'Share your plan in Activity. Mark the rescue in progress when it begins.'
            : 'A guardian has claimed this rescue. Check Activity for updates or add information that could help.',
      };
    case 'in_rescue':
      return {
        responsibility,
        nextStep: canManage
          ? 'Keep Activity updated. Mark this cat safe once the rescue is complete and the cat is in care.'
          : 'The rescue is in progress. Check Activity for the latest information from the team.',
      };
    case 'safe':
      return {
        responsibility,
        nextStep: canManage
          ? 'Add a care update. When the cat is ready for a forever home, mark it ready to adopt.'
          : 'This cat is in care. Adoption requests open if the team marks the cat ready to adopt.',
      };
    case 'available':
      return {
        responsibility,
        nextStep: canManage
          ? 'Review adoption requests below. Approve only when the placement is agreed: approval marks this cat adopted.'
          : 'Send an adoption request below. The reporter or assigned guardian reviews requests; sending one does not confirm a placement.',
      };
    case 'adopted':
      return {
        responsibility,
        nextStep:
          'This cat has been marked adopted. The rescue story and updates remain in Activity.',
      };
    case 'archived':
      return {
        responsibility,
        nextStep: 'This report is closed. Its previous updates remain in Activity.',
      };
  }
}

export const ADOPTION_REQUEST_META: Record<
  AdoptionInterest['status'],
  { label: string; description: string }
> = {
  pending: {
    label: 'Request pending',
    description:
      'Your request is waiting for review by the reporter or assigned guardian. A placement has not been confirmed.',
  },
  approved: {
    label: 'Request approved',
    description:
      'Your adoption request was approved! Arrange the handover with the lister in the comments below. Meet somewhere public or at a vet, and never post your home address.',
  },
  declined: {
    label: 'Request declined',
    description: 'Your request was not selected. You can explore other cats ready to adopt.',
  },
  withdrawn: {
    label: 'Request withdrawn',
    description: 'This adoption request is no longer active.',
  },
};
