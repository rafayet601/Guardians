import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { BrandMark, Text } from '@/components/ui';
import { colors, layout, spacing } from '@/theme';

export function AuthHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <View style={styles.top}>
        <BrandMark />
        <PressableScale
          onPress={() => router.replace('/welcome')}
          accessibilityRole="button"
          accessibilityLabel="Back to welcome"
          style={styles.back}
        >
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </PressableScale>
      </View>
      <Text variant="overline" color={colors.primary}>
        A little care. A big difference.
      </Text>
      <Text variant="display" accessibilityRole="header">
        {title}
      </Text>
      <Text muted>{subtitle}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  header: { gap: spacing.sm, paddingTop: spacing.xl, paddingBottom: spacing.xxl },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xxl,
  },
  back: {
    minWidth: layout.touchTarget,
    minHeight: layout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
