// Shared helper: SSRF-safe photo loading for the AI edge functions (Deno).
// -----------------------------------------------------------------------------
// `lost_cats.photo_url` and `sighting_photos.url` are plain client-written text,
// so an edge function must NEVER fetch() them directly: a malicious value could
// point the function's server-side network vantage at internal endpoints (SSRF)
// or at a multi-hundred-MB body that gets buffered and base64-encoded in the
// isolate. Instead we require the URL to be a public object URL in this
// project's `cat-photos` bucket (0005), extract the object path, and download
// the bytes through the storage API with the service-role client — the
// user-controlled string is only ever parsed, never fetched.

export const CAT_PHOTOS_BUCKET = 'cat-photos';
const PUBLIC_PREFIX = `/storage/v1/object/public/${CAT_PHOTOS_BUCKET}/`;

// Anthropic rejects images over 5MB, and the vision call is the only consumer,
// so anything bigger is invalid input rather than a soft limit.
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

// Structural type so callers can pass their untyped `createClient(...)` admin
// client without fighting supabase-js generics under `deno check`.
interface StorageDownloadClient {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
}

/**
 * Extract the object path from a public cat-photos URL, or null when the URL
 * is malformed or points anywhere other than this bucket. Only the pathname is
 * inspected — the host is irrelevant because we never fetch the URL itself.
 */
export function catPhotoPathFromUrl(photoUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(photoUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!parsed.pathname.startsWith(PUBLIC_PREFIX)) return null;
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(parsed.pathname.slice(PUBLIC_PREFIX.length));
  } catch {
    return null;
  }
  if (!objectPath || objectPath.includes('..')) return null;
  return objectPath;
}

/**
 * Download a cat photo's bytes via the storage API (service-role client).
 * Throws on: URL outside the cat-photos bucket, storage error, or a body over
 * MAX_PHOTO_BYTES.
 */
export async function downloadCatPhoto(
  admin: StorageDownloadClient,
  photoUrl: string,
): Promise<ArrayBuffer> {
  const objectPath = catPhotoPathFromUrl(photoUrl);
  if (!objectPath) {
    throw new Error('Photo URL is not a cat-photos bucket object');
  }
  const { data, error } = await admin.storage.from(CAT_PHOTOS_BUCKET).download(objectPath);
  if (error || !data) {
    throw new Error(`photo download failed: ${error?.message ?? 'no data'}`);
  }
  if (data.size > MAX_PHOTO_BYTES) {
    throw new Error(`photo too large: ${data.size} bytes (max ${MAX_PHOTO_BYTES})`);
  }
  return await data.arrayBuffer();
}
