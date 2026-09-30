import { isScreeningCleared, type AdopterScreening } from '@/types/models';

function screening(overrides: Partial<AdopterScreening> = {}): AdopterScreening {
  return {
    id: 's1',
    user_id: 'u1',
    status: 'approved',
    id_status: 'verified',
    full_name: 'Jordan Rivera',
    dob: '1990-01-01',
    phone: '+1 555 0100',
    address_line: '123 Maple St',
    city: 'Portland',
    postal: '97201',
    housing: 'own',
    landlord_permission: null,
    household_adults: 1,
    household_children: 0,
    other_pets: false,
    pets_details: null,
    vet_name: null,
    vet_phone: null,
    experience: null,
    hours_alone: 4,
    home_visit_consent: true,
    cruelty_attestation: true,
    consent: true,
    consent_at: new Date().toISOString(),
    consent_version: 'v1',
    score: 100,
    reasons: [],
    id_provider: 'manual',
    id_session_id: null,
    id_doc_paths: [],
    verified_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('isScreeningCleared', () => {
  it('clears an approved + verified + unexpired screening', () => {
    expect(isScreeningCleared(screening())).toBe(true);
  });

  it('rejects null/undefined', () => {
    expect(isScreeningCleared(null)).toBe(false);
    expect(isScreeningCleared(undefined)).toBe(false);
  });

  it('rejects pending, needs_review, rejected, and expired rows', () => {
    expect(isScreeningCleared(screening({ status: 'pending' }))).toBe(false);
    expect(isScreeningCleared(screening({ status: 'needs_review' }))).toBe(false);
    expect(isScreeningCleared(screening({ status: 'rejected' }))).toBe(false);
    expect(
      isScreeningCleared(screening({ expires_at: new Date(Date.now() - 1000).toISOString() })),
    ).toBe(false);
  });

  it('rejects unverified or failed ID', () => {
    expect(isScreeningCleared(screening({ id_status: 'pending' }))).toBe(false);
    expect(isScreeningCleared(screening({ id_status: 'failed' }))).toBe(false);
    expect(isScreeningCleared(screening({ id_status: 'unverified' }))).toBe(false);
  });
});
