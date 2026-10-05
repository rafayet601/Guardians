import { Ionicons } from '@expo/vector-icons';
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

import { PressableScale } from '@/components/PressableScale';
import { SightingCard } from '@/components/SightingCard';
import { Button, EmptyState, Loading, Screen, Text } from '@/components/ui';
import { useFeed } from '@/hooks/useSightings';
import { colors, radius, spacing } from '@/theme';
import type { CatTemperament } from '@/types/models';

const FILTERS: { label: string; value?: CatTemperament }[] = [
  { label: 'All personalities' },
  { label: 'Friendly', value: 'friendly' },
  { label: 'Shy', value: 'shy' },
  { label: 'Feral', value: 'feral' },
  { label: 'Not yet known', value: 'unknown' },
];

export default function AdoptScreen() {
  const router = useRouter();
  const [temperament, setTemperament] = useState<CatTemperament>();
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const feed = useFeed(['available'], temperament);
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Screen padded={false}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={feed.isRefetching && !feed.isFetchingNextPage}
            onRefresh={feed.refetch}
            tintColor={colors.primaryDark}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetching && !feed.isError) void feed.fetchNextPage();
        }}
        initialNumToRender={8}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text variant="overline" color={colors.primaryDark}>
              A forever home starts with you
            </Text>
            <Text variant="title">Meet your next companion.</Text>
            <Text variant="small" muted>
              Meet cats ready for adoption and connect with the person caring for them.
            </Text>
            <PressableScale
              onPress={() => setShowHowItWorks((shown) => !shown)}
              accessibilityRole="button"
              accessibilityLabel="How adoption works"
              accessibilityState={{ expanded: showHowItWorks }}
              aria-expanded={showHowItWorks}
              style={styles.explainerToggle}
            >
              <Ionicons name="heart-outline" size={20} color={colors.primaryDark} />
              <Text variant="smallStrong" color={colors.primaryDark} style={styles.flex}>
                How adoption works
              </Text>
              <Ionicons
                name={showHowItWorks ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.primaryDark}
              />
            </PressableScale>
            {showHowItWorks ? (
              <View style={styles.howItWorks}>
                <Text variant="small" muted>
                  Open a cat’s report and send interest. The lister reviews your request and
                  coordinates the next steps. Sending interest isn’t an adoption confirmation.
                </Text>
              </View>
            ) : null}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
            >
              {FILTERS.map((filter) => (
                <PressableScale
                  key={filter.label}
                  onPress={() => setTemperament(filter.value)}
                  accessibilityRole="button"
                  accessibilityLabel={`Personality: ${filter.label}`}
                  accessibilityState={{ selected: temperament === filter.value }}
                  aria-pressed={temperament === filter.value}
                  style={[styles.chip, temperament === filter.value && styles.selected]}
                >
                  <Text
                    variant="smallStrong"
                    color={temperament === filter.value ? colors.white : colors.text}
                  >
                    {filter.label}
                  </Text>
                </PressableScale>
              ))}
            </ScrollView>
            <Text variant="small" muted>
              Personality is reported by the community and may change as a cat settles into care.
            </Text>
            {feed.isError && !feed.isFetchNextPageError && items.length > 0 ? (
              <View style={styles.notice}>
                <Text variant="small" muted>
                  We couldn’t refresh these listings. You can retry below.
                </Text>
                <Button title="Retry listings" variant="outline" onPress={() => feed.refetch()} />
              </View>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <SightingCard
            title={item.title}
            status={item.status}
            temperament={item.temperament}
            color={item.color}
            isInjured={item.is_injured}
            thumbnailUrl={item.photos?.[0]?.url}
            createdAt={item.created_at}
            onPress={() => router.push(`/sighting/${item.id}`)}
          />
        )}
        ListEmptyComponent={
          feed.isLoading ? (
            <Loading label="Finding cats ready for a home…" />
          ) : feed.isError ? (
            <EmptyState
              title="Adoption listings couldn’t load"
              message="Check your connection and try again."
              actionLabel="Retry listings"
              onAction={() => feed.refetch()}
            />
          ) : (
            <EmptyState
              icon="🏠"
              title={
                temperament
                  ? 'No matches for this personality yet'
                  : 'Their next chapter is still ahead'
              }
              message={
                temperament
                  ? 'Try all personalities to meet other cats ready for a home.'
                  : 'When a rescued cat is ready for adoption, their report will appear here. You can help a rescue along the way.'
              }
              actionLabel={temperament ? 'Show all personalities' : 'Explore cats needing help'}
              onAction={() =>
                temperament
                  ? setTemperament(undefined)
                  : router.push({ pathname: '/map', params: { filter: 'needs_help' } })
              }
            />
          )
        }
        ListFooterComponent={
          feed.isFetchingNextPage ? (
            <ActivityIndicator color={colors.primaryDark} style={styles.footer} />
          ) : feed.isFetchNextPageError ? (
            <Button
              title="Load more cats — try again"
              variant="outline"
              onPress={() => feed.fetchNextPage()}
            />
          ) : feed.hasNextPage ? (
            <Button title="Meet more cats" variant="outline" onPress={() => feed.fetchNextPage()} />
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
  header: { gap: spacing.md, marginBottom: spacing.lg },
  explainerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
  },
  howItWorks: {
    padding: spacing.md,
    backgroundColor: colors.primaryTint,
    borderRadius: radius.lg,
  },
  filters: { gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    minHeight: 44,
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  separator: { height: spacing.md },
  footer: { padding: spacing.lg },
  notice: { gap: spacing.md },
});
