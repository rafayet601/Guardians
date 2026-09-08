import { colors } from '@/theme';

/** Neutral local illustration: never substitute another animal's photograph. */
export function catPhoto(_seed: string, size = 240): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 240 240"><rect width="240" height="240" fill="${colors.surface}"/><path d="M65 98V58l39 23a79 79 0 0 1 32 0l39-23v40c21 49-1 85-55 85s-76-36-55-85Z" fill="${colors.border}"/><circle cx="99" cy="125" r="5" fill="${colors.textMuted}"/><circle cx="141" cy="125" r="5" fill="${colors.textMuted}"/><path d="m113 143 7 7 7-7" fill="${colors.textMuted}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
