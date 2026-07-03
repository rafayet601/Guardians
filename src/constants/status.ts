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
    fg: palette.blue500,
    bg: palette.blue100,
    description: 'A guardian has committed to this rescue.',
  },
  in_rescue: {
    label: 'Rescue in progress',
    icon: '🚗',
    fg: palette.violet500,
    bg: palette.violet100,
    description: 'A guardian is actively rescuing this cat.',
  },
  safe: {
    label: 'Safe',
    icon: '💚',
    fg: palette.green700,
    bg: palette.green100,
    description: 'Rescued and in care (vet or foster).',
  },
  available: {
    label: 'Ready to adopt',
    icon: '🏠',
    fg: palette.pink500,
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
    fg: palette.slate500,
    bg: palette.slate100,
    description: 'This report has been closed.',
  },
};

/**
 * Allowed forward transitions a reporter/guardian can trigger from the UI.
 * Mirrors `is_valid_transition` in the database (claim & adopt have their own
 * dedicated actions and are intentionally excluded here).
 */
export const NEXT_STATUSES: Partial<Record<CatStatus, CatStatus[]>> = {
  claimed: ['in_rescue', 'archived'],
  in_rescue: ['safe', 'archived'],
  safe: ['available', 'archived'],
  available: ['safe', 'archived'],
};

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
