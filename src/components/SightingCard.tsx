import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { StatusPill } from '@/components/StatusPill';
import { Card, Pill, Text } from '@/components/ui';
import { TEMPERAMENT_META } from '@/constants/status';
import { colors, spacing } from '@/theme';
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
  /** Retained for existing consumers; missing photos always use an honest placeholder. */
  seed?: string;
  distanceM?: number | null;
  createdAt: string;
  timeLabel?: string;
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
  timeLabel,
  onPress,
}: SightingCardProps) {
  const temp = TEMPERAMENT_META[temperament];
  const urgent = needsUrgentHelp && ['spotted', 'claimed', 'in_rescue'].includes(status);
  return (
    <Card
      onPress={onPress}
      padded={false}
      style={styles.card}
      accessibilityLabel={`${title?.trim() || 'Cat sighting'}, ${status === 'available' ? 'ready to adopt' : status.replaceAll('_', ' ')}${urgent ? ', urgent help needed' : ''}`}
      accessibilityHint="Open the report and rescue timeline"
    >
      <View style={styles.row}>
        {thumbnailUrl ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.thumb}
            contentFit="cover"
            transition={180}
            accessibilityLabel="Reported cat photo"
          />
        ) : (
          <View style={[styles.thumb, styles.placeholder]}>
            <Ionicons name="paw-outline" size={28} color={colors.primaryDark} />
            <Text variant="caption" muted center>
              No photo yet
            </Text>
          </View>
        )}

        <View style={styles.body}>
          <View style={styles.headerRow}>
            <Text variant="subheading" numberOfLines={1} style={styles.title}>
              {title?.trim() || 'Cat sighting'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>

          <StatusPill status={status} />
          {urgent ? (
            <Text variant="smallStrong" color={colors.danger}>
              Urgent help needed
            </Text>
          ) : null}

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
              {timeLabel ? `${timeLabel} ` : ''}
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
  thumb: { width: 96, alignSelf: 'stretch', minHeight: 116, backgroundColor: colors.primaryTint },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  body: { flex: 1, padding: spacing.md, gap: spacing.xs },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
});
