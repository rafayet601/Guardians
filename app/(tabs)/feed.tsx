import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { SightingCard } from '@/components/SightingCard';
import { getDemoSightingPhoto } from '@/utils/demoSightings';
import { SponsoredCard } from '@/components/SponsoredCard';
import { EmptyState, Loading, PageHeader, Text } from '@/components/ui';
import { useFeed } from '@/hooks/useSightings';
import { colors, layout, motion, radius, spacing } from '@/theme';
import type { CatStatus } from '@/types/models';

type Filter = { key: string; label: string; statuses?: CatStatus[] };

const FILTERS: Filter[] = [
  { key: 'all', label: 'All' },
  { key: 'spotted', label: 'Needs a guardian', statuses: ['spotted'] },
  { key: 'rescue', label: 'In rescue', statuses: ['claimed', 'in_rescue', 'safe'] },
  { key: 'available', label: 'Adoptable', statuses: ['available'] },
  { key: 'adopted', label: 'Adopted', statuses: ['adopted'] },
];

export default function FeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion() ?? false;
  const [filterKey, setFilterKey] = useState('all');

  const statuses = FILTERS.find((f) => f.key === filterKey)?.statuses;
  const {
    data,
    isLoading,
    isError,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useFeed(statuses);
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <Animated.View
        entering={
          reduced
            ? undefined
            : FadeInDown.duration(motion.enter).springify().damping(motion.damping)
        }
        style={styles.header}
      >
        <PageHeader
          eyebrow="The community"
          title="Little lives. Big stories."
          subtitle="Follow their journey from spotted to safe."
          icon="paw-outline"
        />
      </Animated.View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterList}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((item) => {
          const active = item.key === filterKey;
          return (
            <PressableScale
              key={item.key}
              onPress={() => setFilterKey(item.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filter: ${item.label}`}
            >
              <View style={[styles.chip, active && styles.chipActive]}>
                <Text variant="smallStrong" color={active ? colors.white : colors.text}>
                  {item.label}
                </Text>
              </View>
            </PressableScale>
          );
        })}
      </ScrollView>

      {isLoading ? (
        <Loading label="Loading sightings…" />
      ) : isError && items.length === 0 ? (
        <EmptyState
          title="Could not load sightings"
          message="Check your connection and try again."
          actionLabel={isRefetching ? 'Retrying…' : 'Try again'}
          onAction={isRefetching ? undefined : () => void refetch()}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) fetchNextPage();
          }}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={11}
          removeClippedSubviews
          ListHeaderComponent={<SponsoredCard slot="feed_card" style={styles.feedAd} />}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} style={styles.footerLoader} />
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="🐾"
              title="No cats here yet"
              message="When cats are reported in this category they'll show up here."
              actionLabel="Report a cat"
              onAction={() => router.push('/report')}
            />
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={
                reduced
                  ? undefined
                  : FadeInDown.delay(Math.min(index, 8) * motion.stagger)
                      .duration(motion.enter)
                      .springify()
                      .damping(motion.damping)
              }
            >
              <SightingCard
                variant="feature"
                title={item.title}
                status={item.status}
                temperament={item.temperament}
                color={item.color}
                isInjured={item.is_injured}
                needsUrgentHelp={item.needs_urgent_help}
                thumbnailUrl={item.photos?.[0]?.url ?? null}
                demoPhoto={getDemoSightingPhoto(item)}
                seed={item.id}
                createdAt={item.created_at}
                onPress={() => router.push(`/sighting/${item.id}`)}
              />
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: {},
  // Explicit height + centered items so the horizontal bar can never collapse
  // and clip the chips (which crowded the sponsored card below).
  filterList: {
    flexGrow: 0,
    height: 52,
    marginBottom: spacing.xs,
    width: '100%',
    maxWidth: layout.contentMax,
    alignSelf: 'center',
  },
  filterRow: { paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: 'center' },
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  listContent: {
    padding: spacing.xl,
    paddingBottom: spacing.bottomClearance,
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.contentMax,
    alignSelf: 'center',
  },
  sep: { height: spacing.md },
  feedAd: { marginBottom: spacing.md },
  footerLoader: { paddingVertical: spacing.lg },
});
