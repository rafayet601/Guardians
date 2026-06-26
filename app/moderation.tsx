import { FlatList, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Loading, Pill, Text } from '@/components/ui';
import { useIsModerator, useModerateContent, useModerationQueue } from '@/hooks/useModeration';
import { notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme';
import { timeAgo } from '@/utils/format';
import type { ModerationTarget } from '@/types/models';

export default function ModerationScreen() {
  const { data: isModerator, isLoading: roleLoading } = useIsModerator();
  const { data: queue, isLoading } = useModerationQueue();
  const moderate = useModerateContent();

  if (roleLoading) return <Loading label="Checking access…" />;
  if (!isModerator) {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>🔒</Text>
        <Text variant="heading" center>
          Moderators only
        </Text>
        <Text variant="small" muted center>
          You don't have access to this area.
        </Text>
      </View>
    );
  }
  if (isLoading) return <Loading label="Loading reports…" />;

  const act = (type: ModerationTarget, id: string, hide: boolean) =>
    moderate.mutate(
      { type, id, hide },
      { onError: (e) => notify('Action failed', getErrorMessage(e, 'Please try again.')) },
    );

  return (
    <FlatList
      data={queue ?? []}
      keyExtractor={(i) => `${i.target_type}:${i.target_id}`}
      contentContainerStyle={styles.content}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListEmptyComponent={
        <EmptyState icon="🛡️" title="All clear" message="No open reports to review right now." />
      }
      renderItem={({ item }) => {
        const canHide = item.target_type === 'sighting' || item.target_type === 'comment';
        return (
          <Card style={styles.row}>
            <View style={styles.rowTop}>
              <Pill label={item.target_type} fg={colors.accentDark} bg={colors.accentSoft} />
              <Text variant="caption" muted>
                {item.report_count} report{item.report_count > 1 ? 's' : ''} · {timeAgo(item.latest_at)}
              </Text>
            </View>
            {item.latest_reason ? (
              <Text variant="small" muted numberOfLines={3}>
                “{item.latest_reason}”
              </Text>
            ) : null}
            <Text variant="caption" muted numberOfLines={1}>
              ID: {item.target_id}
            </Text>
            <View style={styles.actions}>
              {canHide ? (
                <Button
                  title="Hide"
                  variant="danger"
                  size="sm"
                  onPress={() => act(item.target_type, item.target_id, true)}
                  style={styles.btn}
                />
              ) : null}
              <Button
                title="Dismiss"
                variant="outline"
                size="sm"
                onPress={() => act(item.target_type, item.target_id, false)}
                style={styles.btn}
              />
            </View>
          </Card>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.xs, backgroundColor: colors.background },
  emoji: { fontSize: 52, marginBottom: spacing.xs },
  content: { padding: spacing.lg, flexGrow: 1, backgroundColor: colors.background },
  sep: { height: spacing.md },
  row: { gap: spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  btn: { minWidth: 96 },
});
