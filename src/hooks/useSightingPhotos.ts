import { useMutation, useQueryClient } from '@tanstack/react-query';

import { addPhoto } from '@/api/sightings';
import { uploadCatPhoto, type LocalAsset } from '@/api/storage';
import { withTimeout } from '@/lib/async';
import { queryKeys } from '@/lib/queryClient';
import { useAuth } from '@/providers/AuthProvider';

/** The database refuses more than this many photos per report (0011). */
export const MAX_SIGHTING_PHOTOS = 12;

const UPLOAD_TIMEOUT_MS = 45_000;

/**
 * Add a photo to a report that already exists: to recover from a failed attach
 * at posting time, or to show a rescued cat in care (the street photo is often
 * the only thing an adopter ever sees).
 */
export function useAddSightingPhoto(sightingId: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (asset: LocalAsset) => {
      if (!user) throw new Error('Not authenticated');
      const url = await withTimeout(
        uploadCatPhoto(user.id, asset),
        UPLOAD_TIMEOUT_MS,
        'The photo took too long to upload. Please try again.',
      );
      return addPhoto(sightingId, url, user.id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.sighting(sightingId) });
      // The first photo becomes the thumbnail on the map and in the feed.
      qc.invalidateQueries({ queryKey: ['sightings'] });
    },
  });
}
