import { getSightingGuidance } from '@/utils/sightingGuidance';
import type { Sighting } from '@/types/models';

const claimed: Pick<Sighting, 'status' | 'reporter_id' | 'claimed_by' | 'claimer'> = {
  status: 'claimed',
  reporter_id: 'reporter',
  claimed_by: 'guardian',
  claimer: { id: 'guardian', username: 'CatHelper', avatar_url: null, level: 1 },
};

describe('case responsibility and next steps', () => {
  it('distinguishes the reporter from the assigned guardian', () => {
    expect(getSightingGuidance(claimed, 'reporter').responsibility).toBe('CatHelper is assigned');
    expect(getSightingGuidance(claimed, 'guardian').responsibility).toBe(
      'You are the assigned guardian',
    );
  });

  it('does not imply an assigned rescue is unclaimed when the profile is unavailable', () => {
    expect(getSightingGuidance({ ...claimed, claimer: null }, 'visitor').responsibility).toBe(
      'A guardian is assigned',
    );
  });

  it('does not use a stale profile to imply a guardian is assigned', () => {
    expect(
      getSightingGuidance({ ...claimed, status: 'spotted', claimed_by: null }, 'visitor')
        .responsibility,
    ).toBe('No guardian assigned');
  });

  it('gives both managers the status action while visitors get coordination guidance', () => {
    for (const userId of ['reporter', 'guardian']) {
      expect(getSightingGuidance(claimed, userId).nextStep).toContain(
        'Mark the rescue in progress',
      );
    }
    expect(getSightingGuidance(claimed, 'visitor').nextStep).not.toContain('Mark the rescue');
    expect(
      getSightingGuidance({ ...claimed, reporter_id: null, claimed_by: null }).nextStep,
    ).not.toContain('Mark the rescue');
  });

  it('explains the different adoption outcomes for managers and applicants', () => {
    const available = { ...claimed, status: 'available' as const };
    expect(getSightingGuidance(available, 'reporter').nextStep).toContain(
      'approval marks this cat adopted',
    );
    expect(getSightingGuidance(available, 'visitor').nextStep).toContain(
      'does not confirm a placement',
    );
  });
});
