import type { AdoptionInterest, Sighting } from '@/types/models';

type CaseSummary = Pick<Sighting, 'status' | 'reporter_id' | 'claimed_by' | 'claimer'>;

/** Copy reflects the existing lifecycle; it never grants permission to change it. */
export function getSightingGuidance(sighting: CaseSummary, userId?: string) {
  const isClaimer = !!userId && userId === sighting.claimed_by;
  const canManage = isClaimer || (!!userId && userId === sighting.reporter_id);
  const responsibility = sighting.claimed_by
    ? isClaimer
      ? 'You are the assigned guardian'
      : `${sighting.claimer?.username || 'A guardian'} is assigned`
    : 'No guardian assigned';

  switch (sighting.status) {
    case 'spotted':
      return {
        responsibility,
        nextStep:
          'Claim this rescue when you can take responsibility. Add a comment if you have a new sighting or useful information.',
      };
    case 'claimed':
      return {
        responsibility,
        nextStep: canManage
          ? 'Share your plan in Activity. Mark the rescue in progress when it begins.'
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
    description: 'Your adoption request was approved and this cat has been marked adopted.',
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
