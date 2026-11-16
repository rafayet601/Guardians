import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type AlertPreferences,
  getAlertPreferences,
  saveAlertPreferences,
} from '@/api/alertPreferences';
import { queryKeys } from '@/lib/queryClient';
import { useAuth } from '@/providers/AuthProvider';

/** Null data means nothing saved yet: the screen shows the defaults. */
export function useAlertPreferences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.alertPreferences(user?.id),
    queryFn: getAlertPreferences,
    enabled: !!user,
  });
}

export function useSaveAlertPreferences() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (vars: {
      prefs: Omit<AlertPreferences, 'home' | 'homeSource'>;
      pinHome?: { lat: number; lng: number };
    }) => saveAlertPreferences(vars.prefs, vars.pinHome),
    onSuccess: (saved) => qc.setQueryData(queryKeys.alertPreferences(user?.id), saved),
  });
}
