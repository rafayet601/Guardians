import { CatStatus, CatTemperament } from '@/types/models';
import { palette } from '@/theme';

interface StatusMeta {
  label: string;
  icon: string; // emoji
  fg: string;
  bg: string;
  description: string;
}

export const STATUS_META: Record<CatStatus, StatusMeta> = {
  spotted: {
    label: 'Spotted',
    icon: '👀',
    fg: palette.amber600,
    bg: palette.amber100,
    description: 'Reported and waiting for a guardian to help.',
  },
  claimed: {
    label: 'Guardian on the way',
    icon: '🦸',
    fg: palette.blue700,
    bg: palette.blue100,
    description: 'A guardian has committed to this rescue.',
  },
  in_rescue: {
    label: 'Rescue in progress',
    icon: '🚗',
    fg: palette.violet700,
    bg: palette.violet100,
    description: 'A guardian is actively rescuing this cat.',
  },
  safe: {
    label: 'Safe',
    icon: '💚',
    fg: palette.green800,
    bg: palette.green100,
    description: 'Rescued and in care (vet or foster).',
  },
  available: {
    label: 'Ready to adopt',
    icon: '🏠',
    fg: palette.pink700,
    bg: palette.pink100,
    description: 'Looking for a forever home.',
  },
  adopted: {
    label: 'Adopted',
    icon: '🎉',
    fg: palette.green900,
    bg: palette.green100,
    description: 'Found a forever home!',
  },
  archived: {
    label: 'Closed',
    icon: '📁',
    fg: palette.slate700,
    bg: palette.slate100,
    description: 'This report has been closed.',
  },
};

/**
 * Transitions a reporter/guardian can trigger from the UI. Mirrors the rows of
 * `is_valid_transition` (0002) that `update_sighting_status` accepts: claim &
 * adopt have dedicated actions and are excluded, and `in_rescue -> claimed` /
 * `safe -> in_rescue` are deliberately not offered (a regression would re-send
 * the reporter a "claimed" push).
 *
 * `claimed -> spotted` is the RELEASE exit: it clears the Guardian so a cat is
 * never stranded behind someone who cannot follow through. `spotted ->
 * archived` lets a reporter withdraw a report made by mistake.
 */
export const NEXT_STATUSES: Partial<Record<CatStatus, CatStatus[]>> = {
  spotted: ['archived'],
  claimed: ['in_rescue', 'spotted', 'archived'],
  in_rescue: ['safe', 'archived'],
  safe: ['available', 'archived'],
  available: ['safe', 'archived'],
};

/**
 * "Urgent" is a call for a Guardian, so it only holds while the cat is still
 * waiting for one. The flag itself is never cleared server-side; without this
 * a claimed, safe or adopted cat keeps its alarm styling and real emergencies
 * stop standing out on the map.
 */
export function isUrgentNow(status: CatStatus, needsUrgentHelp: boolean | undefined): boolean {
  return !!needsUrgentHelp && status === 'spotted';
}

/** How long a claimed rescue can stay silent before the reporter may reopen it. */
export const CLAIM_STALE_HOURS = 24;

/**
 * True when nothing has happened on a claimed rescue for {@link CLAIM_STALE_HOURS}.
 * `lastActivityAt` is the newest timeline entry; the claim time is the fallback.
 */
export function isClaimStale(
  claimedAt: string | null | undefined,
  lastActivityAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const reference = Date.parse(lastActivityAt ?? claimedAt ?? '');
  if (!Number.isFinite(reference)) return false;
  return now - reference >= CLAIM_STALE_HOURS * 3_600_000;
}

export interface StatusAction {
  /** Status the update_sighting_status RPC will move the sighting to. */
  status: CatStatus;
  label: string;
  variant: 'primary' | 'outline';
  confirmTitle: string;
  confirmMessage?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Stored on the timeline so the change says who did what and why. */
  note?: string;
}

export interface StatusActionContext {
  isOwner: boolean;
  isClaimer: boolean;
  /** No activity for {@link CLAIM_STALE_HOURS}; lets the reporter reopen a claimed cat. */
  claimStale?: boolean;
}

/**
 * The status buttons a viewer should see for a sighting. The database lets the
 * reporter AND the assigned Guardian make every transition in NEXT_STATUSES;
 * this decides which of them are sensible for each role.
 */
export function getStatusActions(from: CatStatus, ctx: StatusActionContext): StatusAction[] {
  if (!ctx.isOwner && !ctx.isClaimer) return [];
  const actions: StatusAction[] = [];
  for (const to of NEXT_STATUSES[from] ?? []) {
    const action = describeAction(from, to, ctx);
    if (action) actions.push(action);
  }
  return actions;
}

function describeAction(
  from: CatStatus,
  to: CatStatus,
  ctx: StatusActionContext,
): StatusAction | null {
  if (to === 'archived') {
    // Only the reporter can withdraw a cat nobody has claimed yet.
    if (from === 'spotted' && !ctx.isOwner) return null;
    const byline = ctx.isOwner ? 'reporter' : 'guardian';
    return {
      status: to,
      label: 'Close report',
      variant: 'outline',
      confirmTitle: 'Close this report?',
      confirmMessage:
        from === 'spotted'
          ? 'Use this if the cat has been found, has moved on, or was reported by mistake. Guardians will stop seeing it, and this cannot be undone.'
          : 'Guardians will stop seeing this cat and it leaves the map. This cannot be undone. If you just cannot continue, release the rescue instead.',
      confirmLabel: 'Close report',
      destructive: true,
      note: `Report closed by the ${byline}.`,
    };
  }

  if (from === 'claimed' && to === 'spotted') {
    if (ctx.isClaimer) {
      return {
        status: to,
        label: "Release — I can't do this",
        variant: 'outline',
        confirmTitle: 'Release this rescue?',
        confirmMessage:
          'The cat goes back on the map so another Guardian can step in, and you will no longer see its exact location. If you can, leave a comment first so the next Guardian knows what you found.',
        confirmLabel: 'Release',
        note: 'Guardian released the claim. This cat is back on the map.',
      };
    }
    if (ctx.isOwner && ctx.claimStale) {
      return {
        status: to,
        label: 'Guardian not responding? Reopen',
        variant: 'outline',
        confirmTitle: 'Reopen for other Guardians?',
        confirmMessage: `There has been no activity for over ${CLAIM_STALE_HOURS} hours. This removes the current Guardian and puts the cat back on the map so someone else can help.`,
        confirmLabel: 'Reopen',
        note: 'Reporter reopened this report for other Guardians.',
      };
    }
    return null;
  }

  if (from === 'available' && to === 'safe') {
    return {
      status: to,
      label: 'Pause adoption listing',
      variant: 'outline',
      confirmTitle: 'Pause this adoption listing?',
      confirmMessage:
        'The cat moves back to Safe and new adoption requests stop until you list it again.',
      confirmLabel: 'Pause listing',
    };
  }

  const meta = STATUS_META[to];
  return {
    status: to,
    label: `${meta.icon} Mark as ${meta.label}`,
    variant: 'primary',
    confirmTitle: `Mark as "${meta.label}"?`,
    confirmLabel: 'Confirm',
  };
}

export const TEMPERAMENT_META: Record<CatTemperament, { label: string; icon: string }> = {
  friendly: { label: 'Friendly', icon: '😺' },
  shy: { label: 'Shy', icon: '🙀' },
  feral: { label: 'Feral', icon: '😼' },
  unknown: { label: 'Unknown', icon: '🐱' },
};

export const STATUS_OPTIONS: CatStatus[] = [
  'spotted',
  'claimed',
  'in_rescue',
  'safe',
  'available',
  'adopted',
];
