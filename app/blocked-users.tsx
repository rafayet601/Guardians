import { FlatList, StyleSheet, View } from 'react-native';

import type { BlockedUser } from '@/api/moderation';
import { Avatar, Button, Card, EmptyState, Loading, Text } from '@/components/ui';
import { useBlockedUsers, useUnblockUser } from '@/hooks/useModeration';
import { confirmAsync, notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme';
import { timeAgo } from '@/utils/format';

export default function BlockedUsersScreen() {
  const { data: blocked, isLoading } = useBlockedUsers();
  const unblock = useUnblockUser();

  if (isLoading) return <Loading label="Loading blocked users…" />;

  const onUnblock = async (item: BlockedUser) => {
    const name = item.full_name ?? item.username;
    const ok = await confirmAsync({
      title: `Unblock ${name}?`,
      message: "They'll be able to see your activity again.",
      confirmLabel: 'Unblock',
    });
    if (!ok) return;
    unblock.mutate(item.blocked_id, {
      onSuccess: () => notify('User unblocked', `${name} can see your activity again.`),
      onError: (e) => notify('Could not unblock', getErrorMessage(e, 'Please try again.')),
    });
  };

  return (
    <FlatList
      data={blocked ?? []}
      keyExtractor={(i) => i.blocked_id}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListEmptyComponent={
        <EmptyState
          icon="🛡️"
          title="No blocked users"
          message="When you block someone, they'll show up here so you can unblock them anytime."
        />
      }
      renderItem={({ item }) => {
        const name = item.full_name ?? item.username;
        return (
          <Card style={styles.row}>
            <Avatar url={item.avatar_url} name={name} size={44} />
            <View style={styles.info}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="caption" muted numberOfLines={1}>
                @{item.username} · Blocked {timeAgo(item.blocked_at)}
              </Text>
            </View>
            <Button
              title="Unblock"
              variant="outline"
              size="sm"
              onPress={() => onUnblock(item)}
              accessibilityRole="button"
              accessibilityLabel={`Unblock ${name}`}
            />
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, flexGrow: 1, backgroundColor: colors.background },
  sep: { height: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  info: { flex: 1, gap: 2 },
});
