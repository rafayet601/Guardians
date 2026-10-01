import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState, type KeyboardEvent } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/PressableScale';
import { SightingCard } from '@/components/SightingCard';
import { SponsoredCard } from '@/components/SponsoredCard';
import { Button, EmptyState, Loading, PageHeader, QueryNotice, Text } from '@/components/ui';
import { isUrgentNow } from '@/constants/status';
import { useBlockedIds } from '@/hooks/useModeration';
import { useFeed } from '@/hooks/useSightings';
import { withoutBlocked } from '@/lib/blocking';
import { colors, layout, radius, spacing } from '@/theme';
import type { CatStatus } from '@/types/models';
import { getDemoSightingPhoto } from '@/utils/demoSightings';

const GARDEN = require('../../assets/illustrations/guardian-garden.webp');
type Filter = { key: string; label: string; description: string; statuses?: CatStatus[] };
const FILTERS: Filter[] = [
  { key: 'all', label: 'All', description: 'Latest sightings' },
  {
    key: 'spotted',
    label: 'Needs a guardian',
    description: 'Waiting for a guardian',
    statuses: ['spotted'],
  },
  {
    key: 'rescue',
    label: 'In rescue',
    description: 'On the way to safety',
    statuses: ['claimed', 'in_rescue', 'safe'],
  },
  {
    key: 'available',
    label: 'Adoptable',
    description: 'Ready for a home',
    statuses: ['available'],
  },
  { key: 'adopted', label: 'Adopted', description: 'Found their family', statuses: ['adopted'] },
];

export default function FeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const columns = width >= layout.wideBreakpoint ? 2 : 1;
  const [filterKey, setFilterKey] = useState('all');
  const filter = FILTERS.find((f) => f.key === filterKey) ?? FILTERS[0];
  const {
    data,
    isLoading,
    isError,
    isRefetching,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useFeed(filter.statuses);
  const blockedIds = useBlockedIds();
  const items = withoutBlocked(data?.pages.flatMap((p) => p.items) ?? [], blockedIds);

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <FlatList
        key={columns}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.columns : undefined}
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
          // A failed page remains available for an explicit retry, not an endless scroll loop.
          if (hasNextPage && !isFetching && !isError) void fetchNextPage();
        }}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={11}
        ListHeaderComponent={
          <View>
            <PageHeader
              eyebrow="Spotted. Safe. Home."
              title="Community"
              subtitle="Find cats to help and follow their journey home."
              icon="paw-outline"
              style={styles.pageHeader}
            />
            <PressableScale
              onPress={() => router.push('/')}
              accessibilityRole="button"
              accessibilityLabel="Explore nearby cats on the map"
              style={styles.mapPrompt}
            >
              <View style={styles.promptCopy}>
                <Text variant="heading" color={colors.primaryDeep}>
                  A little help goes a long way.
                </Text>
                <Text variant="small" color={colors.textSecondary}>
                  See who needs a guardian near you.
                </Text>
                <View style={styles.mapLink}>
                  <Ionicons name="map-outline" size={16} color={colors.primary} />
                  <Text variant="smallStrong" color={colors.primary}>
                    Explore the map
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color={colors.primary} />
                </View>
              </View>
              <Image
                source={GARDEN}
                style={styles.promptArt}
                contentFit="cover"
                accessible={false}
              />
            </PressableScale>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              accessibilityRole="radiogroup"
              accessibilityLabel="Sighting stage"
            >
              {FILTERS.map((item, index) => {
                const active = item.key === filterKey;
                return (
                  <PressableScale
                    key={item.key}
                    onPress={() => setFilterKey(item.key)}
                    accessibilityRole="radio"
                    aria-checked={active}
                    {...(Platform.OS === 'web'
                      ? {
                          tabIndex: active ? 0 : -1,
                          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
                            let next: number;
                            switch (event.key) {
                              case 'ArrowRight':
                              case 'ArrowDown':
                                next = (index + 1) % FILTERS.length;
                                break;
                              case 'ArrowLeft':
                              case 'ArrowUp':
                                next = (index + FILTERS.length - 1) % FILTERS.length;
                                break;
                              case 'Home':
                                next = 0;
                                break;
                              case 'End':
                                next = FILTERS.length - 1;
                                break;
                              case ' ':
                                event.preventDefault();
                                setFilterKey(item.key);
                                return;
                              default:
                                return;
                            }
                            event.preventDefault();
                            setFilterKey(FILTERS[next].key);
                            const choices = event.currentTarget
                              .closest('[role="radiogroup"]')
                              ?.querySelectorAll<HTMLElement>('[role="radio"]');
                            choices?.[next]?.focus();
                          },
                        }
                      : {})}
                    accessibilityLabel={`Filter: ${item.label}`}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text
                      variant="smallStrong"
                      color={active ? colors.white : colors.textSecondary}
                    >
                      {item.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionCopy}>
                <Text variant="heading" accessibilityRole="header">
                  {filter.description}
                </Text>
                <Text variant="small" muted>
                  Newest first · Community reports
                </Text>
              </View>
              <Button
                title="Refresh"
                size="sm"
                variant="ghost"
                loading={isRefetching}
                onPress={() => void refetch()}
                accessibilityLabel="Refresh sightings"
              />
            </View>
            {isError && data && !isFetchNextPageError ? (
              <QueryNotice
                message="Couldn't refresh sightings. You're viewing the last loaded results."
                onRetry={() => void refetch()}
                retrying={isRefetching}
              />
            ) : null}
            <SponsoredCard slot="feed_card" style={styles.feedAd} />
          </View>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator color={colors.primary} style={styles.footerLoader} />
          ) : isFetchNextPageError ? (
            <View style={styles.footerLoader}>
              <QueryNotice
                message="Couldn't load more sightings. Your current results are still here."
                onRetry={() => void fetchNextPage()}
                retrying={isFetchingNextPage}
              />
            </View>
          ) : null
        }
        ListEmptyComponent={
          isLoading ? (
            <Loading label="Loading sightings…" />
          ) : isError && !data ? (
            <EmptyState
              title="Could not load sightings"
              message="Check your connection and try again."
              actionLabel="Try again"
              onAction={() => void refetch()}
            />
          ) : filterKey !== 'all' ? (
            <EmptyState
              compact
              title={`No ${filter.label.toLowerCase()} sightings yet`}
              message="Try another stage to see the rest of the community's reports."
              actionLabel="Show all sightings"
              onAction={() => setFilterKey('all')}
            />
          ) : (
            <EmptyState
              compact
              title="Every rescue starts with a sighting"
              message="Seen a cat that needs help? Add a report so nearby guardians can find them."
              actionLabel="Report a cat"
              onAction={() => router.push('/report')}
            />
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.cell, columns > 1 && styles.gridCell]}>
            <SightingCard
              variant="feature"
              title={item.title}
              status={item.status}
              temperament={item.temperament}
              color={item.color}
              isInjured={item.is_injured}
              needsUrgentHelp={isUrgentNow(item.status, item.needs_urgent_help)}
              thumbnailUrl={item.photos?.[0]?.url ?? null}
              demoPhoto={getDemoSightingPhoto(item)}
              seed={item.id}
              createdAt={item.created_at}
              onPress={() => router.push(`/sighting/${item.id}`)}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  listContent: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.bottomClearance,
    flexGrow: 1,
    width: '100%',
    maxWidth: layout.browseMax,
    alignSelf: 'center',
  },
  pageHeader: { paddingHorizontal: 0, maxWidth: layout.browseMax },
  mapPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    gap: spacing.md,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.xl,
    marginBottom: spacing.xs,
  },
  promptCopy: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  promptArt: { width: 100, alignSelf: 'stretch', minHeight: 140 },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  filterRow: { paddingVertical: spacing.lg, gap: spacing.sm, alignItems: 'center' },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  sectionCopy: { flex: 1, gap: spacing.xs },
  columns: { gap: spacing.xl },
  cell: { width: '100%' },
  gridCell: { flex: 1, maxWidth: '50%' },
  sep: { height: spacing.xl },
  feedAd: { marginBottom: spacing.md },
  footerLoader: { paddingVertical: spacing.lg },
});
