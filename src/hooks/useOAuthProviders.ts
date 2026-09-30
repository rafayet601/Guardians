import { useQuery } from '@tanstack/react-query';
import { getOAuthProviders } from '@/api/auth';

export function useOAuthProviders() {
  return useQuery({
    queryKey: ['auth', 'providers'],
    queryFn: getOAuthProviders,
    staleTime: 60_000,
    retry: 1,
  });
}
