import type { ScreeningReviewItem } from '@/api/screening';
import type { AdopterScreening } from '@/types/models';
import {
  EMPTY_SCREENING_FORM,
  idDocPathsForSubmit,
  screeningFormDefaults,
  screeningStatusCopy,
} from '@/utils/screeningForm';
import {
  approvalBlockers,
  describeCare,
  describeHome,
  describePets,
} from '@/utils/screeningReview';

const item = (over: Partial<ScreeningReviewItem> = {}): ScreeningReviewItem => ({
  user_id: 'u1',
  username: 'jordan',
  status: 'pending',
  id_status: 'pending',
  full_name: 'Jordan Rivera',
  dob: '1990-01-01',
  age: 35,
  city: 'Portland',
  postal: '97201',
  housing: 'own',
  landlord_permission: null,
  household_adults: 2,
  household_children: 0,
  other_pets: false,
  pets_details: null,
  vet_name: null,
  vet_phone: null,
  experience: null,
  hours_alone: 4,
  home_visit_consent: true,
  cruelty_attestation: true,
  score: 100,
  reasons: [],
  id_doc_paths: ['u1/id.jpg'],
  submitted_at: '2026-09-28T10:00:00Z',
  ...over,
});

const screening = (over: Partial<AdopterScreening> = {}): AdopterScreening => ({
  id: 's1',
  user_id: 'u1',
  status: 'pending',
  id_status: 'pending',
  full_name: 'Jordan Rivera',
  dob: '1990-01-01',
  phone: '555-0100',
  address_line: '1 Main St',
  city: 'Portland',
  postal: '97201',
  housing: 'rent',
  landlord_permission: true,
  household_adults: 1,
  household_children: 2,
  other_pets: true,
  pets_details: null,
  vet_name: 'Oak Vets',
  vet_phone: null,
  experience: null,
  hours_alone: 6,
  home_visit_consent: true,
  cruelty_attestation: true,
  consent: true,
  consent_at: '2026-09-01T00:00:00Z',
  consent_version: 'v1',
  score: 80,
  reasons: [],
  id_provider: 'manual',
  id_session_id: null,
  id_doc_paths: ['u1/front.jpg', 'u1/back.jpg'],
  verified_at: null,
  expires_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

describe('approvalBlockers (mirrors review_adopter_screening)', () => {
  it('lets a complete, adult applicant who attested be approved', () => {
    expect(approvalBlockers(item())).toEqual([]);
  });

  it('explains every reason the approve button is off', () => {
    expect(
      approvalBlockers(item({ id_doc_paths: [], age: 17, cruelty_attestation: false })),
    ).toEqual([
      'No ID photo uploaded yet',
      'Under 18',
      'Did not confirm no animal-cruelty convictions',
    ]);
  });
});

describe('review summaries', () => {
  it('describes the home, flagging a renter without landlord permission', () => {
    expect(describeHome(item())).toBe('Owns their home · 2 adults');
    expect(
      describeHome(item({ housing: 'rent', landlord_permission: false, household_adults: 1 })),
    ).toBe('Rents, no landlord permission yet · 1 adult');
    expect(
      describeHome(item({ housing: 'rent', landlord_permission: true, household_children: 1 })),
    ).toBe('Rents, landlord allows cats · 2 adults, 1 child');
  });

  it('describes pets and the vet reference', () => {
    expect(describePets(item())).toBe('No other pets');
    expect(
      describePets(
        item({ other_pets: true, pets_details: '1 dog', vet_name: 'Oak Vets', vet_phone: '555' }),
      ),
    ).toBe('Other pets: 1 dog · Vet: Oak Vets (555)');
    expect(describePets(item({ other_pets: true }))).toBe('Other pets: yes (no details)');
  });

  it('describes care and the home visit', () => {
    expect(describeCare(item())).toBe('Alone up to 4 h a day · Agrees to a home visit');
    expect(describeCare(item({ home_visit_consent: false }))).toMatch(/No home visit consent/);
  });
});

describe('screening form', () => {
  it('starts empty for a first-time applicant', () => {
    expect(screeningFormDefaults(null)).toEqual(EMPTY_SCREENING_FORM);
  });

  it('starts from the last submission, but asks for consent again', () => {
    const values = screeningFormDefaults(screening());
    expect(values).toMatchObject({
      full_name: 'Jordan Rivera',
      housing: 'rent',
      landlord_permission: true,
      household_children: 2,
      vet_name: 'Oak Vets',
      pets_details: '',
      vet_phone: '',
      consent: false,
    });
  });

  it('keeps the ID photos on file unless new ones were added', () => {
    const existing = screening();
    expect(idDocPathsForSubmit([], existing)).toEqual(['u1/front.jpg', 'u1/back.jpg']);
    expect(idDocPathsForSubmit(['u1/new.jpg'], existing)).toEqual(['u1/new.jpg']);
    expect(idDocPathsForSubmit([], null)).toEqual([]);
  });
});

describe('screeningStatusCopy', () => {
  it('lists what a reviewer asked for, with the next step', () => {
    const copy = screeningStatusCopy(
      screening({ status: 'needs_review', reasons: ['Please upload the back of your ID'] }),
      false,
    );
    expect(copy.headline).toMatch(/needs a little more/);
    expect(copy.toFix).toEqual(['Please upload the back of your ID']);
    expect(copy.next).toMatch(/submit again/);
  });

  it('does not promise a timeline it cannot keep, and says who reviews', () => {
    expect(screeningStatusCopy(screening(), false).next).toMatch(/by hand/);
  });

  it('shows cleared with nothing to fix, whatever old flags remain', () => {
    const copy = screeningStatusCopy(
      screening({ status: 'approved', id_status: 'verified', reasons: ['old flag'] }),
      true,
    );
    expect(copy).toEqual({ headline: '✅ Cleared — you can adopt', next: null, toFix: [] });
  });
});
