import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/ui';
import { colors, fontFamily, radius, shadow, spacing } from '@/theme';

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion() ?? false;
  // Home and Map have prominent report actions; the floating action stays out
  // of adoption discovery and pushed detail routes.
  const pathname = usePathname();
  const showReportFab = ['/feed', '/leaderboard', '/rewards', '/profile'].includes(pathname);

  return (
    <View style={styles.flex}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primaryDark,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: [
            styles.tabBar,
            { height: 64 + insets.bottom, paddingBottom: spacing.sm + insets.bottom },
          ],
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
            tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="adopt"
          options={{
            title: 'Adopt',
            tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="feed"
          options={{
            title: 'Community',
            tabBarIcon: ({ color, size }) => <Ionicons name="paw" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="leaderboard"
          options={{
            href: null,
            title: 'Community impact',
            tabBarIcon: ({ color, size }) => <Ionicons name="trophy" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="rewards"
          options={{
            href: null,
            title: 'Rewards',
            tabBarIcon: ({ color, size }) => <Ionicons name="gift" size={size} color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
          }}
        />
      </Tabs>

      {/* Floating "report" action, anchored bottom-right so it never collides
          with a tab. Springs in on mount and on press. Hidden on the Map tab,
          which renders its own Report pill above the nearby-sightings sheet. */}
      {showReportFab ? (
        <Animated.View
          entering={
            reduced ? undefined : FadeInDown.delay(180).duration(520).springify().damping(12)
          }
          style={[styles.fabWrap, { bottom: 64 + spacing.lg + insets.bottom }]}
        >
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Report a cat"
            onPress={() => router.push('/report')}
            style={styles.fab}
            scaleTo={0.9}
          >
            <Ionicons name="add" size={28} color={colors.white} />
            <Text variant="caption" color={colors.white} style={styles.fabLabel}>
              REPORT
            </Text>
          </PressableScale>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.divider,
    height: 64,
    paddingTop: 6,
    paddingBottom: 8,
  },
  tabLabel: { fontSize: 11, fontFamily: fontFamily.bodySemibold, fontWeight: '600' },
  fabWrap: { position: 'absolute', right: spacing.lg },
  fab: {
    backgroundColor: colors.primary,
    width: 62,
    height: 62,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
    ...shadow.floating,
  },
  fabLabel: { marginTop: -3, letterSpacing: 0.5, fontSize: 9 },
});
