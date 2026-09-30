/**
 * Reject if `promise` has not settled within `ms`. The underlying work keeps
 * running (a fetch cannot be cancelled from here); this only stops the caller
 * waiting forever, which matters on a flaky connection when someone is trying
 * to report an injured cat.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
