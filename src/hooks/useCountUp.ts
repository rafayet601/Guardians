import { useEffect, useRef, useState } from 'react';

/**
 * Eases a number from `from` up to `target` over `duration` ms (easeOutCubic).
 * Pure JS / requestAnimationFrame so it works identically on native and web.
 */
export function useCountUp(target: number, duration = 900, from = 0): number {
  const [value, setValue] = useState(from);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = from;
    const delta = target - start;
    if (delta === 0) {
      setValue(target);
      return;
    }
    let startTs: number | null = null;
    const tick = (t: number) => {
      if (startTs == null) startTs = t;
      const p = Math.min(1, (t - startTs) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(start + delta * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration, from]);

  return value;
}
