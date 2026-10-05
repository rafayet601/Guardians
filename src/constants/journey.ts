import type { CatStatus } from '@/types/models';

export const RESCUE_STAGES = [
  { label: 'Spotted', statuses: ['spotted'] },
  { label: 'Rescuing', statuses: ['claimed', 'in_rescue'] },
  { label: 'Safe', statuses: ['safe'] },
  { label: 'Finding home', statuses: ['available'] },
  { label: 'Home', statuses: ['adopted'] },
] as const;

export const NEXT_STEP: Record<CatStatus, string> = {
  spotted: 'Waiting for a Guardian. Add any new observations to the timeline.',
  claimed: 'Coordinate in the timeline, then update the report when the rescue begins.',
  in_rescue: 'Keep the community updated. Mark safe once the cat is in care.',
  safe: 'Arrange ongoing care. When ready, make the cat available for adoption.',
  available: 'Review adoption interest and coordinate a responsible handoff.',
  adopted: 'A journey worth celebrating. This cat has found a home.',
  archived: 'This report is closed.',
};

export function rescueStageIndex(status: CatStatus): number {
  return RESCUE_STAGES.findIndex((stage) =>
    (stage.statuses as readonly CatStatus[]).includes(status),
  );
}
