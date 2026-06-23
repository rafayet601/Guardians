/**
 * Deterministic placeholder imagery for records that have no uploaded photo
 * yet (e.g. seeded sightings). The same seed always yields the same picture, so
 * a given cat keeps a stable thumbnail across renders.
 */

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * An example cat photo for a sighting with no real image. LoremFlickr's `lock`
 * param makes the result deterministic for a given seed.
 */
export function catPhoto(seed: string, size = 240): string {
  const lock = (hashCode(seed) % 4000) + 1;
  return `https://loremflickr.com/${size}/${size}/cat,kitten?lock=${lock}`;
}
