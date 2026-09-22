import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { StatusPill } from '@/components/StatusPill';
import { Card, Pill, Text } from '@/components/ui';
import { TEMPERAMENT_META } from '@/constants/status';
import { colors, radius, spacing } from '@/theme';
import type { CatStatus, CatTemperament } from '@/types/models';
import { formatDistance, timeAgo } from '@/utils/format';

export interface SightingCardProps {
  variant?: 'compact' | 'feature';
  title?: string | null;
  status: CatStatus;
  temperament?: CatTemperament;
  color?: string | null;
  isInjured?: boolean;
  needsUrgentHelp?: boolean;
  thumbnailUrl?: string | null;
  /** Bundled, labeled demo image for a known seeded sighting only. */
  demoPhoto?: number | null;
  /** Retained for compatibility with existing sighting callers. */
  seed?: string;
  distanceM?: number | null;
  createdAt: string;
  onPress?: () => void;
}

export function SightingCard({
  variant = 'compact',
  title,
  status,
  temperament = 'unknown',
  color,
  isInjured,
  needsUrgentHelp,
  thumbnailUrl,
  demoPhoto,
  distanceM,
  createdAt,
  onPress,
}: SightingCardProps) {
  const temp = TEMPERAMENT_META[temperament];
  const [failedPhoto, setFailedPhoto] = useState<string | number | null>(null);
  const photo = thumbnailUrl || demoPhoto;
  const isDemoPhoto = !thumbnailUrl && !!demoPhoto;
  const feature = variant === 'feature';
  return (
    <Card onPress={onPress} padded={false} style={styles.card}>
      <View style={[styles.row, feature && styles.featureRow]}>
        <View style={[styles.photoWrap, feature && styles.featurePhoto]}>
          {photo && failedPhoto !== photo ? (
            <Image
              source={thumbnailUrl ? { uri: thumbnailUrl } : demoPhoto}
              style={styles.photo}
              contentFit="cover"
              transition={180}
              onError={() => setFailedPhoto(photo)}
              accessibilityLabel={`${isDemoPhoto ? 'AI-generated demo photo: ' : ''}${title?.trim() || 'Reported cat'}`}
            />
          ) : (
            <View style={styles.noPhoto}>
              <Ionicons name="paw-outline" size={36} color={colors.primary} />
              <Text variant="caption" color={colors.primary}>
                {photo ? 'Photo unavailable' : 'No photo yet'}
              </Text>
            </View>
          )}
          {isDemoPhoto && failedPhoto !== photo && (
            <View style={feature ? styles.featureDemoLabel : styles.demoLabel}>
              <Pill label="Demo photo" fg={colors.primaryDark} bg={colors.surface} />
            </View>
          )}
          {feature && (
            <View style={styles.photoStatus}>
              <StatusPill status={status} />
            </View>
          )}
          {feature && needsUrgentHelp && (
            <View style={styles.urgentFlag}>
              <Ionicons name="alert-circle" size={14} color={colors.white} />
              <Text variant="caption" color={colors.white}>
                Needs urgent help
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.body, feature && styles.featureBody]}>
          <View style={styles.headerRow}>
            <Text
              variant={feature ? 'heading' : 'subheading'}
              numberOfLines={2}
              style={styles.title}
            >
              {title?.trim() || 'Cat sighting'}
            </Text>
            {needsUrgentHelp && !feature ? (
              <Ionicons
                name="alert-circle"
                size={18}
                color={colors.urgent}
                accessibilityLabel="Urgent"
              />
            ) : (
              <Ionicons name="arrow-forward" size={18} color={colors.primary} />
            )}
          </View>

          {!feature && <StatusPill status={status} />}

          <View style={styles.metaRow}>
            <Text variant="small" muted>
              {temp.label}
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
                {formatDistance(distanceM)} away
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
  photoWrap: {
    width: 100,
    minHeight: 136,
    backgroundColor: colors.primaryTint,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%', position: 'absolute' },
  noPhoto: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  featureRow: { flexDirection: 'column' },
  featurePhoto: { width: '100%', aspectRatio: 1.65, minHeight: 180 },
  featureBody: { padding: spacing.lg, gap: spacing.sm },
  demoLabel: { position: 'absolute', bottom: spacing.xs, alignSelf: 'center' },
  featureDemoLabel: { position: 'absolute', top: spacing.md, right: spacing.md },
  photoStatus: { position: 'absolute', top: spacing.md, left: spacing.md },
  urgentFlag: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    backgroundColor: colors.urgent,
    borderRadius: radius.sm,
  },
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
