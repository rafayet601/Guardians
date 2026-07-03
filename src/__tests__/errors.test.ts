import { getErrorMessage } from '@/lib/errors';

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
