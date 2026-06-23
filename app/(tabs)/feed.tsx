import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { SightingCard } from '@/components/SightingCard';
import { SponsoredCard } from '@/components/SponsoredCard';
import { EmptyState, Loading, Text } from '@/components/ui';
import { useFeed } from '@/hooks/useSightings';
import { colors, motion, radius, spacing } from '@/theme';
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
  const [filterKey, setFilterKey] = useState('all');

  const statuses = FILTERS.find((f) => f.key === filterKey)?.statuses;
  const { data, isLoading, isRefetching, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useFeed(statuses);
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <Animated.View
        entering={FadeInDown.duration(motion.enter).springify().damping(motion.damping)}
        style={styles.header}
      >
        <Text variant="title">Recent cats</Text>
        <Text variant="small" muted>
          The latest reports from your community.
        </Text>
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
            <PressableScale key={item.key} onPress={() => setFilterKey(item.key)}>
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
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
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
            />
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.delay(Math.min(index, 8) * motion.stagger)
                .duration(motion.enter)
                .springify()
                .damping(motion.damping)}
            >
              <SightingCard
                title={item.title}
                status={item.status}
                temperament={item.temperament}
                color={item.color}
                isInjured={item.is_injured}
                needsUrgentHelp={item.needs_urgent_help}
                thumbnailUrl={item.photos?.[0]?.url ?? null}
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
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: 2 },
  // Explicit height + centered items so the horizontal bar can never collapse
  // and clip the chips (which crowded the sponsored card below).
  filterList: { flexGrow: 0, height: 48, marginTop: spacing.md, marginBottom: spacing.xs },
  filterRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, alignItems: 'center' },
  chip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  listContent: { padding: spacing.lg, flexGrow: 1 },
  sep: { height: spacing.md },
  feedAd: { marginBottom: spacing.md },
  footerLoader: { paddingVertical: spacing.lg },
});
