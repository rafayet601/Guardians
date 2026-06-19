import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { StatusPill } from '@/components/StatusPill';
import { Card, Pill, Text } from '@/components/ui';
import { TEMPERAMENT_META } from '@/constants/status';
import { colors, radius, spacing } from '@/theme';
import type { CatStatus, CatTemperament } from '@/types/models';
import { formatDistance, timeAgo } from '@/utils/format';

export interface SightingCardProps {
  title?: string | null;
  status: CatStatus;
  temperament?: CatTemperament;
  color?: string | null;
  isInjured?: boolean;
  needsUrgentHelp?: boolean;
  thumbnailUrl?: string | null;
  distanceM?: number | null;
  createdAt: string;
  onPress?: () => void;
}

export function SightingCard({
  title,
  status,
  temperament = 'unknown',
  color,
  isInjured,
  needsUrgentHelp,
  thumbnailUrl,
  distanceM,
  createdAt,
  onPress,
}: SightingCardProps) {
  const temp = TEMPERAMENT_META[temperament];
  return (
    <Card onPress={onPress} padded={false} style={styles.card}>
      <View style={styles.row}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]}>
            <Text style={styles.thumbEmoji}>{temp.icon}</Text>
          </View>
        )}

        <View style={styles.body}>
          <View style={styles.headerRow}>
            <Text variant="subheading" numberOfLines={1} style={styles.title}>
              {title?.trim() || 'Cat sighting'}
            </Text>
            {needsUrgentHelp ? <Text style={styles.urgent}>🚨</Text> : null}
          </View>

          <StatusPill status={status} />

          <View style={styles.metaRow}>
            <Text variant="small" muted>
              {temp.icon} {temp.label}
            </Text>
            {color ? (
              <Text variant="small" muted>
                · {color}
              </Text>
            ) : null}
            {isInjured ? <Pill label="Injured" fg={colors.danger} bg={colors.accentSoft} /> : null}
          </View>

          <View style={styles.footerRow}>
            {typeof distanceM === 'number' ? (
              <Text variant="caption" color={colors.primary}>
                📍 {formatDistance(distanceM)}
              </Text>
            ) : null}
            <Text variant="caption" muted>
              {timeAgo(createdAt)}
            </Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'stretch' },
  thumb: { width: 96, alignSelf: 'stretch', minHeight: 116 },
  thumbFallback: {
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbEmoji: { fontSize: 36 },
  body: { flex: 1, padding: spacing.md, gap: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1 },
  urgent: { fontSize: 16, marginLeft: spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
});
