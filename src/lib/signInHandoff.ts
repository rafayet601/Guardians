/**
 * Carries the email from sign-up to sign-in so someone who has just been asked
 * to confirm it does not have to type it again. Held in memory rather than in a
 * route param, which would put the address in the URL (browser history, logs)
 * on web. Cleared when the sign-in screen goes away.
 */
let handedOff = '';

export function handOffEmail(email: string): void {
  handedOff = email;
}

export function peekHandedOffEmail(): string {
  return handedOff;
}

export function clearHandedOffEmail(): void {
  handedOff = '';
}
