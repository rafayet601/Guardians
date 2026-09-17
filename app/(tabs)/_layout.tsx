import { Ionicons } from '@expo/vector-icons';
import { Tabs, usePathname, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { Text } from '@/components/ui';
import { colors, fontFamily, layout, radius, shadow, spacing } from '@/theme';

export default function TabsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion() ?? false;
  // The Map tab renders its own "+ Report" pill above the nearby sheet, so the
  // global FAB is shown only on the other four tabs (an allowlist, so it never
  // leaks onto the map or over a pushed modal/detail route).
  const pathname = usePathname();
  const showReportFab = ['/feed', '/leaderboard', '/rewards', '/profile'].includes(pathname);

  return (
    <View style={styles.flex}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: [
            styles.tabBar,
            {
              height: layout.tabHeight + insets.bottom,
              paddingBottom: Math.max(insets.bottom, spacing.sm),
            },
          ],
          tabBarLabelStyle: styles.tabLabel,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Map',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
                <Ionicons name={focused ? 'map' : 'map-outline'} size={22} color={color} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="feed"
          options={{
            title: 'Feed',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
                <Ionicons name={focused ? 'paw' : 'paw-outline'} size={22} color={color} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="leaderboard"
          options={{
            title: 'Ranks',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
                <Ionicons name={focused ? 'trophy' : 'trophy-outline'} size={22} color={color} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="rewards"
          options={{
            title: 'Rewards',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
                <Ionicons name={focused ? 'gift' : 'gift-outline'} size={22} color={color} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, focused }) => (
              <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
                <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
              </View>
            ),
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
          style={[styles.fabWrap, { bottom: layout.tabHeight + spacing.lg + insets.bottom }]}
        >
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Report a cat"
            onPress={() => router.push('/report')}
            style={styles.fab}
            scaleTo={0.9}
          >
            <Ionicons name="add" size={22} color={colors.white} />
            <Text variant="caption" color={colors.white} style={styles.fabLabel}>
              Report a cat
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
    paddingTop: spacing.sm,
  },
  tabLabel: { fontSize: 11, fontFamily: fontFamily.bodySemibold, fontWeight: '600' },
  tabIcon: {
    width: 48,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconActive: { backgroundColor: colors.primaryTint },
  fabWrap: { position: 'absolute', right: spacing.lg },
  fab: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surface,
    ...shadow.floating,
  },
  fabLabel: { letterSpacing: 0 },
});
