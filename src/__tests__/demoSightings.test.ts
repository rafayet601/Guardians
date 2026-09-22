import { getDemoSightingPhoto } from '@/utils/demoSightings';

describe('demo sighting photos', () => {
  it('does not substitute a demo image when a real report loses its reporter', () => {
    const report = {
      id: '00000000-0000-4000-8000-000000000099',
      title: 'Skittish black kitten',
      reporter_id: null,
    };

    // Account deletion sets reporter_id to null; titles are not unique.
    expect(getDemoSightingPhoto(report)).toBeNull();
  });

  it.each([
    '180525a3-1d9d-4ac5-a6ae-c27463fdc9cb',
    '63847f73-af61-4d76-a7c2-c7f20b626697',
    '8cb14cee-3d9d-4ab1-bc09-ead95a131c08',
    '2f1d2c0e-62fb-4a1f-b664-6cd1aac146bb',
    '7e25f8ed-a436-46c2-8bb7-8f369602dd9d',
  ])('keeps the photo of seeded sighting %s after its title is edited', (id) => {
    const report = { id, title: 'Updated demo title', reporter_id: null };
    expect(getDemoSightingPhoto(report)).not.toBeNull();
  });

  it('does not use a demo image for an owned report', () => {
    const report = {
      id: '63847f73-af61-4d76-a7c2-c7f20b626697',
      title: 'Skittish black kitten',
      reporter_id: '00000000-0000-4000-8000-000000000001',
    };
    expect(getDemoSightingPhoto(report)).toBeNull();
  });
});
