import type { Sighting } from '@/types/models';

// Stable IDs shared with supabase/seed.sql and verified against the existing
// demo records. A null reporter alone is not proof of demo data: deleting an
// account also clears reporter_id on real reports. Titles are not identifiers.
const DEMO_PHOTOS: ReadonlyMap<string, number> = new Map([
  ['180525a3-1d9d-4ac5-a6ae-c27463fdc9cb', require('../../assets/demo-cats/orange-tabby.jpg')],
  ['63847f73-af61-4d76-a7c2-c7f20b626697', require('../../assets/demo-cats/black-kitten.jpg')],
  ['8cb14cee-3d9d-4ab1-bc09-ead95a131c08', require('../../assets/demo-cats/grey-cat.jpg')],
  ['2f1d2c0e-62fb-4a1f-b664-6cd1aac146bb', require('../../assets/demo-cats/calico.jpg')],
  ['7e25f8ed-a436-46c2-8bb7-8f369602dd9d', require('../../assets/demo-cats/tuxedo.jpg')],
]);

export function getDemoSightingPhoto(
  sighting: Pick<Sighting, 'id' | 'reporter_id'>,
): number | null {
  if (sighting.reporter_id !== null) return null;
  return DEMO_PHOTOS.get(sighting.id) ?? null;
}
