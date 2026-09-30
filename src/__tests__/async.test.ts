import { withTimeout } from '@/lib/async';

describe('withTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when the work finishes in time', async () => {
    const work = withTimeout(Promise.resolve('done'), 1000, 'too slow');
    await expect(work).resolves.toBe('done');
  });

  it('rejects with the message when the work is too slow', async () => {
    const never = new Promise<string>(() => {});
    const work = withTimeout(never, 1000, 'Upload timed out');
    const assertion = expect(work).rejects.toThrow('Upload timed out');
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('passes through the original error when the work fails first', async () => {
    const work = withTimeout(Promise.reject(new Error('boom')), 1000, 'too slow');
    await expect(work).rejects.toThrow('boom');
  });

  it('does not leave a pending timer behind after settling', async () => {
    await withTimeout(Promise.resolve(1), 1000, 'too slow');
    expect(jest.getTimerCount()).toBe(0);
  });
});
