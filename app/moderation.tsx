import { FlatList, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Loading, Pill, Text } from '@/components/ui';
import { AI_FEATURES } from '@/constants/ai';
import { useModCopilot } from '@/hooks/useAiModeration';
import { useIsModerator, useModerateContent, useModerationQueue } from '@/hooks/useModeration';
import { notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { colors, radius, spacing } from '@/theme';
import { timeAgo } from '@/utils/format';
import type { ModerationQueueItem } from '@/api/moderation';
import type { ModCopilotSummary } from '@/types/ai';
import type { ModerationTarget } from '@/types/models';

/** How the copilot's suggested action reads to a moderator — always advisory. */
const SUGGESTION_LABEL: Record<ModCopilotSummary['recommendedAction'], string> = {
  hide: 'consider hiding this',
  dismiss: 'consider dismissing this report',
  review: 'worth a closer human look',
};

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
      renderItem={({ item }) => <QueueRow item={item} onAct={act} />}
    />
  );
}

/**
 * One queue item. Owns its own copilot mutation so each row's AI briefing is
 * independent (AI-M2 #11). The briefing is ADVISORY text only — every actual
 * decision still goes through the existing Hide/Dismiss controls below it.
 */
function QueueRow({
  item,
  onAct,
}: {
  item: ModerationQueueItem;
  onAct: (type: ModerationTarget, id: string, hide: boolean) => void;
}) {
  const canHide = item.target_type === 'sighting' || item.target_type === 'comment';
  const copilot = useModCopilot();
  // The Edge Function only briefs on sightings and comments.
  const canBrief = AI_FEATURES.modCopilot && canHide;
  const brief = copilot.data;

  const runCopilot = () =>
    copilot.mutate(
      { targetType: item.target_type, targetId: item.target_id },
      {
        onError: (e) =>
          notify('AI summary unavailable', getErrorMessage(e, 'Please review this item manually.')),
      },
    );

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

      {canBrief ? (
        <View style={styles.ai}>
          <Button
            title={brief ? 'Refresh AI summary' : '✨ AI summary'}
            variant="ghost"
            size="sm"
            loading={copilot.isPending}
            onPress={runCopilot}
            style={styles.aiBtn}
          />
          {brief ? (
            <View style={styles.aiPanel}>
              <Text variant="overline" color={colors.primaryDark}>
                AI summary · advisory
              </Text>
              {brief.summary ? <Text variant="small">{brief.summary}</Text> : null}
              {brief.userHistory ? (
                <Text variant="small" muted>
                  {brief.userHistory}
                </Text>
              ) : null}
              <Text variant="small">Suggestion: {SUGGESTION_LABEL[brief.recommendedAction]}.</Text>
              <Text variant="caption" muted>
                A suggestion only — the decision is yours, using the buttons below.
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.actions}>
        {canHide ? (
          <Button
            title="Hide"
            variant="danger"
            size="sm"
            onPress={() => onAct(item.target_type, item.target_id, true)}
            style={styles.btn}
          />
        ) : null}
        <Button
          title="Dismiss"
          variant="outline"
          size="sm"
          onPress={() => onAct(item.target_type, item.target_id, false)}
          style={styles.btn}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xs,
    backgroundColor: colors.background,
  },
  emoji: { fontSize: 52, marginBottom: spacing.xs },
  content: { padding: spacing.lg, flexGrow: 1, backgroundColor: colors.background },
  sep: { height: spacing.md },
  row: { gap: spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  btn: { minWidth: 96 },
  ai: { gap: spacing.sm, marginTop: spacing.xs },
  aiBtn: { alignSelf: 'flex-start', minWidth: 140 },
  aiPanel: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
});
