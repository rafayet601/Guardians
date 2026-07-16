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
  draft: string;
}

export type ModerationVerdict = 'safe' | 'borderline' | 'violation';

export interface ModerationResult {
  verdict: ModerationVerdict;
  categories: string[];
  applied: boolean;
}

export interface ModeratePhotoInput {
  imageBase64: string;
  mediaType?: string;
  target: { type: 'sighting_photo'; id: string };
}

export interface ModerateTextInput {
  type: 'comment';
  id: string;
  text: string;
}

export type ModerationTargetType = 'sighting' | 'comment' | 'profile' | 'photo';

export interface ModCopilotInput {
  targetType: ModerationTargetType;
  targetId: string;
}

export interface ModCopilotSummary {
  recommendedAction: 'hide' | 'dismiss' | 'review';
  summary: string;
  userHistory: string;
}

export type LostCatStatus = 'open' | 'matched' | 'closed';

export interface LostCat {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  photoUrl: string | null;
  lastSeenLat: number;
  lastSeenLng: number;
  lastSeenAt: string | null;
  status: LostCatStatus;
  created_at: string;
  updated_at: string;
}

export interface CreateLostCatInput {
  title?: string;
  description?: string;
  photoUrl?: string;
  lat: number;
  lng: number;
  lastSeenAt?: string;
}

export interface LostCatMatch {
  id: string;
  lost_cat_id: string;
  sighting_id: string;
  confidence: number;
  status: 'suggested' | 'confirmed' | 'rejected';
  created_at: string;
  sightingTitle?: string | null;
  sightingThumbnailUrl?: string | null;
  distanceM?: number;
  sightingCreatedAt?: string;
  createdAt?: string;
}

export interface ReidCandidate {
  linkId: string;
  sightingId: string;
  linkedSightingId: string;
  confidence: number;
  status: 'suggested' | 'confirmed' | 'rejected';
  title?: string | null;
  thumbnailUrl?: string | null;
  distanceM?: number;
}

export interface SightingLink {
  id: string;
  sightingId: string;
  linkedSightingId: string;
  confidence: number;
  status: 'suggested' | 'confirmed' | 'rejected';
}
