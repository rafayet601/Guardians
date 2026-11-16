import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import type { InboxItem } from '@/api/notifications';
import { PressableScale } from '@/components/PressableScale';
import { Button, EmptyState, Loading, QueryNotice, Text } from '@/components/ui';
import { useInbox, useMarkRead } from '@/hooks/useNotifications';
import { notificationRoute } from '@/lib/notificationRoute';
import { colors, radius, spacing } from '@/theme';
import { timeAgo } from '@/utils/format';
import { inboxCopy } from '@/utils/inboxCopy';

/** PRD-2.0 R1.5: every alert and update, whether or not the push arrived. */
export default function InboxScreen() {
  const router = useRouter();
  const inbox = useInbox();
  const markRead = useMarkRead();
  const { refetch } = inbox;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  if (inbox.isLoading) return <Loading label="Loading your inbox…" />;

  const items = inbox.data ?? [];
  const unread = items.filter((i) => !i.read_at).length;

  const open = (item: InboxItem) => {
    if (!item.read_at) markRead.mutate([item.id]);
    const route = notificationRoute({ type: item.kind, sighting_id: item.sighting_id });
    if (route) router.push(route as Parameters<typeof router.push>[0]);
  };

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      style={styles.flex}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={inbox.isRefetching}
          onRefresh={() => void refetch()}
          tintColor={colors.primaryDark}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          {inbox.error ? (
            <QueryNotice message="Could not refresh your inbox." onRetry={() => void refetch()} />
          ) : null}
          {unread > 0 ? (
            <Button
              title={`Mark all ${unread} as read`}
              variant="ghost"
              size="sm"
              loading={markRead.isPending}
              onPress={() => markRead.mutate(undefined)}
              style={styles.markAll}
            />
          ) : null}
        </View>
      }
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListEmptyComponent={
        <EmptyState
          icon="🔔"
          title="Nothing here yet"
          message="Urgent alerts near you and news about cats you're helping will show up here."
        />
      }
      renderItem={({ item }) => {
        const copy = inboxCopy(item);
        const isUnread = !item.read_at;
        return (
          <PressableScale
            onPress={() => open(item)}
            style={[styles.row, isUnread && styles.rowUnread]}
            accessibilityRole="button"
            accessibilityLabel={`${isUnread ? 'Unread. ' : ''}${copy.title}. ${copy.body}`}
          >
            <View style={[styles.icon, copy.urgent && styles.iconUrgent]}>
              <Ionicons
                name={copy.icon}
                size={20}
                color={copy.urgent ? colors.urgent : colors.primaryDark}
              />
            </View>
            <View style={styles.text}>
              <Text variant="bodyStrong" numberOfLines={2}>
                {copy.title}
              </Text>
              <Text variant="small" muted numberOfLines={3}>
                {copy.body}
              </Text>
              <Text variant="caption" muted>
                {timeAgo(item.created_at)}
                {item.silent ? ' · arrived in quiet hours' : ''}
              </Text>
            </View>
            {isUnread ? <View style={styles.dot} accessibilityElementsHidden /> : null}
          </PressableScale>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, flexGrow: 1 },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  markAll: { alignSelf: 'flex-end' },
  sep: { height: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rowUnread: { borderColor: colors.primaryLight, backgroundColor: colors.primaryTint },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  iconUrgent: { backgroundColor: colors.urgentSoft },
  text: { flex: 1, gap: 2 },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    marginTop: spacing.xs,
  },
});
