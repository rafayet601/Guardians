-- Approval applies only to the evidence that was reviewed. This also guards
-- service-role updates from the verification endpoint, not just questionnaire RPCs.
create or replace function public.reset_screening_on_evidence_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if row(old.full_name, old.dob, old.phone, old.address_line, old.city, old.postal, old.housing, old.landlord_permission, old.household_adults, old.household_children, old.other_pets, old.pets_details, old.vet_name, old.vet_phone, old.experience, old.hours_alone, old.home_visit_consent, old.cruelty_attestation, old.consent, old.consent_version, old.id_doc_paths)
     is distinct from row(new.full_name, new.dob, new.phone, new.address_line, new.city, new.postal, new.housing, new.landlord_permission, new.household_adults, new.household_children, new.other_pets, new.pets_details, new.vet_name, new.vet_phone, new.experience, new.hours_alone, new.home_visit_consent, new.cruelty_attestation, new.consent, new.consent_version, new.id_doc_paths) then
    if new.status not in ('rejected', 'needs_review') then
      new.status := 'pending';
    end if;
    new.id_status := 'pending';
    new.verified_at := null;
    new.expires_at := null;
    new.id_session_id := null;
  end if;
  return new;
end;
$$;
revoke all on function public.reset_screening_on_evidence_change() from public;
create trigger reset_screening_evidence before update on public.adopter_screenings
for each row execute function public.reset_screening_on_evidence_change();
