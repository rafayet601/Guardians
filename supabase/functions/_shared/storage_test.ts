import { catPhotoPathFromUrl, downloadCatPhoto, MAX_PHOTO_BYTES } from './storage.ts';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test(
  'cat photo paths cannot escape into private storage after URL normalization',
  async () => {
    const prefix = 'https://project.supabase.co/storage/v1/object/public/cat-photos/';
    const attacks = [
      '%252e%252e/screening-docs/victim/private.jpg',
      '%252E%252E/avatars/victim/avatar.jpg',
      'owner/%252e%252e/%252e%252e/screening-docs/victim/private.jpg',
      '%2e%2e/screening-docs/victim/private.jpg',
      'owner/../..%2fscreening-docs/victim/private.jpg',
      '%2fscreening-docs/victim/private.jpg',
      'owner/%5cphoto.jpg',
      'owner/photo.jpg%3fdownload=other',
      'owner/photo.jpg%23fragment',
      'owner/photo%00.jpg',
      'owner//photo.jpg',
    ];
    let downloads = 0;
    const admin = {
      storage: {
        from: () => ({
          download: () => {
            downloads++;
            return Promise.resolve({ data: new Blob(['private image']), error: null });
          },
        }),
      },
    };
    for (const attack of attacks) {
      assert(catPhotoPathFromUrl(prefix + attack) === null, `Accepted dangerous path: ${attack}`);
      let rejected = false;
      try {
        await downloadCatPhoto(admin, prefix + attack);
      } catch {
        rejected = true;
      }
      assert(rejected, 'Download did not reject dangerous input');
    }
    assert(downloads === 0, 'Dangerous input reached privileged Storage API');
    assert(
      catPhotoPathFromUrl('http://169.254.169.254/latest/meta-data/') === null,
      'Non-bucket URL accepted',
    );
  },
);

Deno.test(
  'normal photos download only from cat-photos and enforce the image size limit',
  async () => {
    let oversized = false;
    const url =
      'https://project.supabase.co/storage/v1/object/public/cat-photos/owner/cat%20photo.jpg';
    const admin = {
      storage: {
        from: (bucket: string) => {
          assert(bucket === 'cat-photos', 'Unexpected storage bucket');
          return {
            download: (path: string) => {
              assert(path === 'owner/cat photo.jpg', 'Wrong object path');
              return Promise.resolve({
                data: new Blob([new Uint8Array(oversized ? MAX_PHOTO_BYTES + 1 : 4)]),
                error: null,
              });
            },
          };
        },
      },
    };
    assert((await downloadCatPhoto(admin, url)).byteLength === 4, 'Valid photo rejected');
    oversized = true;
    let rejected = false;
    try {
      await downloadCatPhoto(admin, url);
    } catch {
      rejected = true;
    }
    assert(rejected, 'Oversized stored image accepted');
  },
);
