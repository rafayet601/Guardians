/**
 * Single place to turn an unknown thrown value into a user-facing message.
 *
 * Supabase, network, and plain JS errors all surface their message differently;
 * screens used to each re-implement `e instanceof Error ? e.message : '…'`.
 * Use this instead so the unwrap logic lives in one spot.
 */
export function getErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

/**
 * `claim_sighting` raises this when another Guardian claimed the cat first.
 * Urgent alerts fan out to every Guardian nearby at once, so losing this race
 * is a normal outcome that deserves a kind message rather than a raw error.
 */
export function isClaimLostError(error: unknown): boolean {
  return /no longer available to claim/i.test(getErrorMessage(error, ''));
}
