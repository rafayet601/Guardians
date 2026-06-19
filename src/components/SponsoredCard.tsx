import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Linking, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/ui';
import { usePlacements } from '@/hooks/useRewards';
import { confirmAsync, notify } from '@/lib/dialog';
import { colors, palette, radius, shadow, spacing } from '@/theme';
import type { PlacementSlot, SponsoredPlacement } from '@/types/models';

const AD_GRADIENT = [palette.amber100, '#FFF6E9'] as const;

/**
 * A direct-sold brand placement. Renders the highest-priority active placement
 * for the given slot, or nothing if there are none. Always labelled
 * "Sponsored"; tapping confirms before opening an external link.
 */
export function SponsoredCard({
  slot,
  style,
}: {
  slot: PlacementSlot;
  style?: StyleProp<ViewStyle>;
}) {
  const { data = [] } = usePlacements(slot);
  const placement = data[0];
  if (!placement) return null;

  return <SponsoredCardView placement={placement} style={style} />;
}

function SponsoredCardView({
  placement,
  style,
}: {
  placement: SponsoredPlacement;
  style?: StyleProp<ViewStyle>;
}) {
  const onPress = async () => {
    if (!placement.cta_url) return;
    const ok = await confirmAsync({
      title: 'Leave Guardians?',
      message: `This opens ${placement.cta_url} in your browser.`,
      confirmLabel: 'Open',
    });
    if (!ok) return;
    try {
      await Linking.openURL(placement.cta_url);
    } catch {
      notify('Could not open link', 'Please try again later.');
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(420)} style={style}>
      <PressableScale onPress={onPress} disabled={!placement.cta_url} style={styles.card} scaleTo={0.985}>
        <LinearGradient
          colors={AD_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {placement.image_url ? (
          <Image source={{ uri: placement.image_url }} style={styles.image} contentFit="cover" />
        ) : null}
        <View style={styles.bodyRow}>
          <View style={styles.body}>
            <View style={styles.labelRow}>
              <Ionicons name="megaphone-outline" size={12} color={colors.accentDark} />
              <Text variant="caption" color={colors.accentDark}>
                SPONSORED
              </Text>
            </View>
            <Text variant="subheading" numberOfLines={2}>
              {placement.title}
            </Text>
            {placement.body ? (
              <Text variant="small" muted numberOfLines={3}>
                {placement.body}
              </Text>
            ) : null}
            {placement.cta_url ? (
              <View style={styles.cta}>
                <Text variant="smallStrong" color={colors.accentDark}>
                  {placement.cta_label || 'Learn more'}
                </Text>
                <Ionicons name="arrow-forward" size={14} color={colors.accentDark} />
              </View>
            ) : null}
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.amber100,
    ...shadow.card,
  },
  image: { width: '100%', height: 120 },
  bodyRow: { flexDirection: 'row' },
  body: { flex: 1, padding: spacing.lg, gap: spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
});
