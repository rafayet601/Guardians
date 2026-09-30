import type { AdopterScreening } from '@/types/models';

/** The background-check form's values (string/number/boolean fields as typed in). */
export interface ScreeningFormValues {
  full_name: string;
  dob: string;
  phone: string;
  address_line: string;
  city: string;
  postal: string;
  housing: 'own' | 'rent' | 'other';
  landlord_permission: boolean | null;
  household_adults: number;
  household_children: number;
  other_pets: boolean;
  pets_details: string;
  vet_name: string;
  vet_phone: string;
  experience: string;
  hours_alone: number;
  home_visit_consent: boolean;
  cruelty_attestation: boolean;
  consent: boolean;
}

export const EMPTY_SCREENING_FORM: ScreeningFormValues = {
  full_name: '',
  dob: '',
  phone: '',
  address_line: '',
  city: '',
  postal: '',
  housing: 'own',
  landlord_permission: null,
  household_adults: 1,
  household_children: 0,
  other_pets: false,
  pets_details: '',
  vet_name: '',
  vet_phone: '',
  experience: '',
  hours_alone: 4,
  home_visit_consent: false,
  cruelty_attestation: false,
  consent: false,
};

/**
 * Start the form from the applicant's last submission, so someone asked for
 * one more detail changes that detail instead of retyping everything. Consent
 * is asked again every time: it covers this submission.
 */
export function screeningFormDefaults(existing: AdopterScreening | null): ScreeningFormValues {
  if (!existing) return EMPTY_SCREENING_FORM;
  return {
    full_name: existing.full_name,
    dob: existing.dob,
    phone: existing.phone,
    address_line: existing.address_line,
    city: existing.city,
    postal: existing.postal,
    housing: existing.housing,
    landlord_permission: existing.landlord_permission,
    household_adults: existing.household_adults,
    household_children: existing.household_children,
    other_pets: existing.other_pets,
    pets_details: existing.pets_details ?? '',
    vet_name: existing.vet_name ?? '',
    vet_phone: existing.vet_phone ?? '',
    experience: existing.experience ?? '',
    hours_alone: existing.hours_alone,
    home_visit_consent: existing.home_visit_consent,
    cruelty_attestation: existing.cruelty_attestation,
    consent: false,
  };
}

/**
 * The ID photos to submit. Newly added photos replace the old ones; with none
 * added, the ones already on file are kept. Sending an empty list would erase
 * them, and a reviewer cannot clear anyone without seeing their ID.
 */
export function idDocPathsForSubmit(
  uploaded: readonly string[],
  existing: AdopterScreening | null,
): string[] {
  if (uploaded.length > 0) return [...uploaded];
  return [...(existing?.id_doc_paths ?? [])];
}

export interface ScreeningStatusCopy {
  headline: string;
  /** What the applicant should do next, if anything. */
  next: string | null;
  /** Reviewer requests and automatic flags, when the applicant has something to fix. */
  toFix: string[];
}

export function screeningStatusCopy(
  existing: AdopterScreening,
  cleared: boolean,
): ScreeningStatusCopy {
  if (cleared) {
    return { headline: '✅ Cleared — you can adopt', next: null, toFix: [] };
  }
  switch (existing.status) {
    case 'approved':
      return { headline: 'Approved — finishing ID verification', next: null, toFix: [] };
    case 'pending':
      return {
        headline: '⏳ Submitted — waiting for review',
        next: "Our team checks your ID by hand, which can take a few days. We'll let you know.",
        toFix: [],
      };
    case 'needs_review':
      return {
        headline: '📝 A reviewer needs a little more',
        next: 'Update your answers below and submit again.',
        toFix: existing.reasons,
      };
    case 'rejected':
      return {
        headline: '❌ Not approved',
        next: 'If something below was a mistake, correct it and submit again.',
        toFix: existing.reasons,
      };
    default:
      return {
        headline: 'Expired — please re-submit below',
        next: 'Checks last 12 months. Confirm your details below to renew.',
        toFix: [],
      };
  }
}
