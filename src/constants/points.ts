/**
 * Point / Kibble awards per action, as a single client-side source of truth for
 * DISPLAY. The authoritative awards are enforced server-side in
 * `supabase/migrations/0002_functions.sql` (`award_points` calls) — these
 * constants must be kept in sync with that migration when the economy changes.
 */
export const POINTS = {
  report: 10, // reported a cat
  claim: 15, // claimed a rescue
  rescue: 50, // completed a rescue (marked safe)
  adopt: 25, // adopted a cat
  place: 30, // placed a cat in a forever home (lister)
} as const;

/** What a guardian earns end-to-end for taking a spotted cat all the way to safe. */
export const CLAIM_TO_RESCUE_TOTAL = POINTS.claim + POINTS.rescue; // 65
