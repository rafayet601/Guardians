import { STATUS_META } from '@/constants/status';
import type { CatStatus } from '@/types/models';
import { Pill } from '@/components/ui';

export function StatusPill({ status }: { status: CatStatus }) {
  const meta = STATUS_META[status];
  return <Pill label={meta.label} icon={meta.icon} fg={meta.fg} bg={meta.bg} />;
}
