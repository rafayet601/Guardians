import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import type { InboxItem } from '@/api/notifications';

export interface InboxCopy {
  title: string;
  body: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  /** Urgent alerts and lease warnings stand out in the list. */
  urgent: boolean;
}

/**
 * How an inbox entry reads. Entries are history, so they say what happened
 * then (from the entry's own detail), not what the case is now; the case
 * screen is one tap away for that.
 */
export function inboxCopy(item: Pick<InboxItem, 'kind' | 'detail' | 'sighting'>): InboxCopy {
  const name = item.sighting?.title?.trim() ?? '';
  const cat = name ? `“${name}”` : 'the cat';
  const Cat = name ? `“${name}”` : 'The cat';
  const yourCat = name ? `“${name}”` : 'the cat you reported';
  const YourCat = name ? `“${name}”` : 'The cat you reported';

  switch (item.kind) {
    case 'urgent_sighting':
      return item.detail.step === 2
        ? {
            title: 'A cat still needed urgent help',
            body: `No one nearer could respond to ${cat}, so the alert reached you.`,
            icon: 'alert-circle',
            urgent: true,
          }
        : {
            title: 'A cat near you needed urgent help',
            body: name || 'An urgent report was made in your alert area.',
            icon: 'alert-circle',
            urgent: true,
          };
    case 'sighting_claimed':
      return {
        title: 'A Guardian took on your report',
        body: `${YourCat} was claimed.`,
        icon: 'shield-checkmark',
        urgent: false,
      };
    case 'rescue_completed':
      return {
        title: 'The cat you reported is safe',
        body: `${YourCat} is safe in care. Thank you for reporting.`,
        icon: 'heart',
        urgent: false,
      };
    case 'case_status':
      return caseStatusCopy(item.detail.status, yourCat, YourCat);
    case 'adoption_interest':
      return {
        title: 'Someone wants to adopt',
        body: `A request came in for ${cat}.`,
        icon: 'home',
        urgent: false,
      };
    case 'adoption_approved':
      return {
        title: 'Your adoption was approved',
        body: `${Cat} is going home with you.`,
        icon: 'home',
        urgent: false,
      };
    case 'adoption_declined':
      return {
        title: 'Update on your adoption request',
        body: `Your request for ${cat} was not accepted.`,
        icon: 'home-outline',
        urgent: false,
      };
    case 'screening_decided':
      return screeningCopy(item.detail.status);
    case 'new_comment':
      return {
        title: 'New comment',
        body: `Someone commented on ${cat}.`,
        icon: 'chatbubble-ellipses',
        urgent: false,
      };
    case 'claim_expiring':
      return {
        title: 'Your claim was about to lapse',
        body: `Post an update or extend your claim on ${cat} to keep it.`,
        icon: 'time',
        urgent: true,
      };
    case 'claim_expired':
      return {
        title: 'Your claim lapsed',
        body: `${Cat} went back on the map for another Guardian.`,
        icon: 'time-outline',
        urgent: false,
      };
    case 'claim_reopened':
      return {
        title: 'Your report opened again',
        body: `The Guardian on ${yourCat} did not post an update in time.`,
        icon: 'refresh',
        urgent: false,
      };
    case 'urgent_unclaimed':
      return {
        title: 'Urgent report unclaimed for an hour',
        body: `Nobody had claimed ${cat}.`,
        icon: 'warning',
        urgent: true,
      };
    case 'urgent_no_responder':
      return {
        title: 'No Guardian had responded yet',
        body: `The alert for ${yourCat} went wider and the Guardians team was told.`,
        icon: 'megaphone',
        urgent: false,
      };
    case 'ops_job_failed':
      return {
        title: 'A background job failed',
        body: 'Check job health in the moderation tools.',
        icon: 'construct',
        urgent: true,
      };
  }
}

function caseStatusCopy(status: string | undefined, yourCat: string, YourCat: string): InboxCopy {
  switch (status) {
    case 'spotted':
      return {
        title: 'Your report opened again',
        body: `The Guardian on ${yourCat} stepped back, so other Guardians can help.`,
        icon: 'refresh',
        urgent: false,
      };
    case 'in_rescue':
      return {
        title: 'Rescue under way',
        body: `${YourCat} went into a Guardian’s care.`,
        icon: 'medkit',
        urgent: false,
      };
    case 'available':
      return {
        title: 'Ready for a home',
        body: `${YourCat} started looking for a forever home.`,
        icon: 'home',
        urgent: false,
      };
    case 'adopted':
      return {
        title: 'Adopted',
        body: `${YourCat} went to a forever home.`,
        icon: 'happy',
        urgent: false,
      };
    case 'archived':
      return {
        title: 'Your report was closed',
        body: `The case for ${yourCat} was closed.`,
        icon: 'archive',
        urgent: false,
      };
    default:
      return {
        title: 'Your report was updated',
        body: `There is news about ${yourCat}.`,
        icon: 'information-circle',
        urgent: false,
      };
  }
}

function screeningCopy(status: string | undefined): InboxCopy {
  switch (status) {
    case 'approved':
      return {
        title: 'You were cleared to adopt',
        body: 'Your background check was approved.',
        icon: 'checkmark-circle',
        urgent: false,
      };
    case 'needs_review':
      return {
        title: 'Your background check needed more information',
        body: 'Open your screening to see what to add.',
        icon: 'document-text',
        urgent: false,
      };
    case 'rejected':
      return {
        title: 'Your background check was not approved',
        body: 'Open your screening to see why.',
        icon: 'close-circle',
        urgent: false,
      };
    default:
      return {
        title: 'Your background check was decided',
        body: 'Open your screening to see the result.',
        icon: 'document-text',
        urgent: false,
      };
  }
}
