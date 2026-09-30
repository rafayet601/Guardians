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

describe('claim ownership guidance', () => {
  it('tells the assigned guardian they may release a rescue they cannot complete', () => {
    expect(getSightingGuidance(claimed, 'guardian').nextStep).toContain('release');
    // The reporter cannot "release" someone else's claim as a courtesy.
    expect(getSightingGuidance(claimed, 'reporter').nextStep).not.toContain('release');
  });

  it('nudges a silent claim towards an update, or towards reopening for the reporter', () => {
    const guardianView = getSightingGuidance(claimed, 'guardian', { claimStale: true }).nextStep;
    expect(guardianView).toContain('release it so another Guardian can help');
    const reporterView = getSightingGuidance(claimed, 'reporter', { claimStale: true }).nextStep;
    expect(reporterView).toContain('reopen this report');
    // Visitors get no management advice either way.
    expect(getSightingGuidance(claimed, 'visitor', { claimStale: true }).nextStep).not.toContain(
      'reopen',
    );
  });

  it('reassures the reporter of an unclaimed report instead of pitching them a claim', () => {
    const spotted = { ...claimed, status: 'spotted' as const, claimed_by: null, claimer: null };
    const owner = getSightingGuidance(spotted, 'reporter').nextStep;
    expect(owner).toContain('Close the report');
    expect(owner).not.toContain('Claim this rescue');
    expect(getSightingGuidance(spotted, 'visitor').nextStep).toContain('Claim this rescue');
  });
});
