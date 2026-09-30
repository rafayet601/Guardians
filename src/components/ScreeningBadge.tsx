import { useApplicantCleared } from '@/hooks/useScreening';
import { Text } from './ui';

/** Lister-side badge per adoption applicant (boolean only — no PII). */
export function ApplicantScreeningBadge({ userId }: { userId: string }) {
  const { data, isPending } = useApplicantCleared(userId);
  if (isPending) return null;
  return (
    <Text variant="small" muted>
      {data ? '✅ Background check cleared' : '⏳ Background check not cleared'}
    </Text>
  );
}
