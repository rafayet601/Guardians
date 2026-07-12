/**
 * Client-side AI result types. Kept here (not inlined) so both the report form
 * and its tests can import them. All AI inference runs server-side in
 * `supabase/functions/ai-*`; these are the shapes those functions return.
 */
import type { CatTemperament } from '@/types/models';

/**
 * Photo → report autofill suggestion (AI-M1 #1). Every field is a *draft* the
 * user reviews and edits before submitting — never wired straight into
 * createSighting. `isInjured` is a SOFT hint ("consider marking this"), never a
 * diagnosis. Shaped to line up with the report form's fields.
 */
export interface ReportAutofillSuggestion {
  title: string;
  description: string;
  color: string;
  /** Distinguishing marks (torn ear, collar…). May be empty. */
  marks: string;
  temperament: CatTemperament;
  isInjured: boolean;
}

/** A single base64 photo + its media type, the autofill endpoint's input. */
export interface ReportAutofillInput {
  imageBase64: string;
  /** e.g. 'image/jpeg'. Defaults server-side to image/jpeg when omitted. */
  mediaType?: string;
}

/**
 * Adoption profile writer (AI-M1 #13). The `ai-adoption-copy` Edge Function
 * turns a sighting's real rescue timeline into a warm, community-voiced listing
 * DRAFT — derived only from the sighting's actual data, never invented. The
 * result is editable: the reporter/guardian reviews it and saves it via the
 * existing sighting-description update path; it is never auto-published.
 */
export interface AdoptionDraft {
  /** The suggested listing body text — plain text, ready to edit. */
  draft: string;
}
