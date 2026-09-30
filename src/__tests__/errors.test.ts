import { getErrorMessage, isClaimLostError } from '@/lib/errors';

describe('getErrorMessage', () => {
  it('returns an Error instance message', () => {
    expect(getErrorMessage(new Error('nope'))).toBe('nope');
  });

  it('returns a non-empty string error verbatim', () => {
    expect(getErrorMessage('plain')).toBe('plain');
  });

  it('reads a `message` property off a plain object (Supabase-style)', () => {
    expect(getErrorMessage({ message: 'rpc failed' })).toBe('rpc failed');
  });

  it('uses the fallback for null/empty/unknown', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
    expect(getErrorMessage(new Error(''), 'fb')).toBe('fb');
    expect(getErrorMessage({}, 'fb')).toBe('fb');
  });
});

describe('isClaimLostError', () => {
  it('recognises the RPC message raised when another Guardian claimed first', () => {
    expect(isClaimLostError({ message: 'This cat is no longer available to claim' })).toBe(true);
    expect(isClaimLostError(new Error('THIS CAT IS NO LONGER AVAILABLE TO CLAIM'))).toBe(true);
  });

  it('does not mistake other failures for a lost race', () => {
    expect(isClaimLostError(new Error('Not authenticated'))).toBe(false);
    expect(isClaimLostError({ message: 'Sighting not found' })).toBe(false);
    expect(isClaimLostError(null)).toBe(false);
    expect(isClaimLostError(undefined)).toBe(false);
  });
});
