import type { ScreeningReviewItem } from '@/api/screening';

/**
 * Why a reviewer cannot approve this applicant yet. Mirrors the server's hard
 * rules in review_adopter_screening (migration 0038) so the button explains
 * itself instead of failing after a tap. The server still enforces them.
 */
export function approvalBlockers(item: ScreeningReviewItem): string[] {
  const blockers: string[] = [];
  if (item.id_doc_paths.length === 0) blockers.push('No ID photo uploaded yet');
  if (item.age < 18) blockers.push('Under 18');
  if (!item.cruelty_attestation) blockers.push('Did not confirm no animal-cruelty convictions');
  return blockers;
}

export function describeHome(item: ScreeningReviewItem): string {
  const housing =
    item.housing === 'own'
      ? 'Owns their home'
      : item.housing === 'rent'
        ? item.landlord_permission
          ? 'Rents, landlord allows cats'
          : 'Rents, no landlord permission yet'
        : 'Other housing';
  const adults = `${item.household_adults} adult${item.household_adults === 1 ? '' : 's'}`;
  const children =
    item.household_children > 0
      ? `, ${item.household_children} child${item.household_children === 1 ? '' : 'ren'}`
      : '';
  return `${housing} · ${adults}${children}`;
}

export function describePets(item: ScreeningReviewItem): string {
  const pets = item.other_pets
    ? `Other pets: ${item.pets_details?.trim() || 'yes (no details)'}`
    : 'No other pets';
  const vet = item.vet_name?.trim()
    ? ` · Vet: ${item.vet_name.trim()}${item.vet_phone?.trim() ? ` (${item.vet_phone.trim()})` : ''}`
    : '';
  return `${pets}${vet}`;
}

export function describeCare(item: ScreeningReviewItem): string {
  return `Alone up to ${item.hours_alone} h a day · ${
    item.home_visit_consent ? 'Agrees to a home visit' : 'No home visit consent'
  }`;
}
