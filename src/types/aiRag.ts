/**
 * Rescue copilot types (AI-M5 #7). RAG-grounded Q&A surfaced on a sighting the
 * current user is the assigned guardian for. The `ai-rescue-copilot` Edge
 * Function retrieves KB chunks (migration 0024) and only answers when retrieval
 * similarity is good; a poor match returns `hasMatch: false` with a graceful
 * deferral — the copilot NEVER fills a KB gap with general training, and NEVER
 * diagnoses or suggests treatment (ai-rag-agent charter).
 *
 * Kept here (not in `@/types/ai`) so this RAG feature owns its own surface and
 * the parallel AI barrels stay untouched.
 */

/**
 * One knowledge-base source the copilot grounded its answer in. Shown to the
 * guardian as a small pill + muted line so they can see the answer is sourced
 * (not invented) and follow back to the reference card it came from.
 */
export interface RescueCopilotSource {
  /** Document title, e.g. "Humane trapping basics". */
  title: string;
  /** Cited source label, e.g. "Alley Cat Allies TNR guide". */
  source: string;
  /** Short excerpt of the matched chunk (≤160 chars). */
  snippet: string;
}

/**
 * The `ai-rescue-copilot` Edge Function's normalized response.
 *
 * `hasMatch` is false when no KB chunk was close enough to the question (the
 * server-side similarity threshold was not met). In that case `answer` is a
 * graceful deferral ("please contact a vet / animal services") and `sources`
 * is empty — the copilot did NOT call the model and did NOT fill the gap with
 * general training. Always surface `hasMatch: false` prominently in the UI so
 * the guardian sees the deferral, not a confident-sounding non-answer.
 */
export interface RescueCopilotAnswer {
  /** The copilot's short, practical, warm answer. */
  answer: string;
  /** KB sources the answer drew from. Empty on a deferral. */
  sources: RescueCopilotSource[];
  /** True when retrieval matched the KB; false when the copilot deferred. */
  hasMatch: boolean;
}

/**
 * Input to `askRescueCopilot`. The server verifies the caller is the sighting's
 * assigned guardian (`claimed_by === auth.uid()`); a non-claimer gets 403 and
 * never reaches the model. The question is non-empty and ≤1000 chars.
 */
export interface AskCopilotInput {
  sightingId: string;
  question: string;
}
