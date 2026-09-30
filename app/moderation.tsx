import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Input, Loading, Pill, Text } from '@/components/ui';
import { AI_FEATURES } from '@/constants/ai';
import { useModCopilot } from '@/hooks/useAiModeration';
import { useIsModerator, useModerateContent, useModerationQueue } from '@/hooks/useModeration';
import { useReviewScreening, useScreeningDocUrls, useScreeningQueue } from '@/hooks/useScreening';
import { confirmAsync, notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { colors, radius, spacing } from '@/theme';
import { timeAgo } from '@/utils/format';
import {
  approvalBlockers,
  describeCare,
  describeHome,
  describePets,
} from '@/utils/screeningReview';
import type { ModerationQueueItem } from '@/api/moderation';
import type { ScreeningDecision, ScreeningReviewItem } from '@/api/screening';
import type { ModCopilotSummary } from '@/types/ai';
import type { ModerationTarget } from '@/types/models';

/** How the copilot's suggested action reads to a moderator — always advisory. */
const SUGGESTION_LABEL: Record<ModCopilotSummary['recommendedAction'], string> = {
  hide: 'consider hiding this',
  dismiss: 'consider dismissing this report',
  review: 'worth a closer human look',
};

type Tab = 'reports' | 'checks';

export default function ModerationScreen() {
  const { data: isModerator, isLoading: roleLoading } = useIsModerator();
  const { data: queue, isLoading } = useModerationQueue();
  const checks = useScreeningQueue();
  const moderate = useModerateContent();
  const [tab, setTab] = useState<Tab>('reports');

  if (roleLoading) return <Loading label="Checking access…" />;
  if (!isModerator) {
    return (
      <View style={styles.center}>
        <Text style={styles.emoji}>🔒</Text>
        <Text variant="heading" center>
          Moderators only
        </Text>
        <Text variant="small" muted center>
          You don&apos;t have access to this area.
        </Text>
      </View>
    );
  }

  const act = (type: ModerationTarget, id: string, hide: boolean) =>
    moderate.mutate(
      { type, id, hide },
      { onError: (e) => notify('Action failed', getErrorMessage(e, 'Please try again.')) },
    );

  const reportCount = queue?.length ?? 0;
  const checkCount = checks.data?.length ?? 0;

  return (
    <View style={styles.page}>
      <View style={styles.tabs} accessibilityRole="tablist">
        <TabButton
          label={`Reports${reportCount ? ` (${reportCount})` : ''}`}
          selected={tab === 'reports'}
          onPress={() => setTab('reports')}
        />
        <TabButton
          label={`Background checks${checkCount ? ` (${checkCount})` : ''}`}
          selected={tab === 'checks'}
          onPress={() => setTab('checks')}
        />
      </View>

      {tab === 'reports' ? (
        isLoading ? (
          <Loading label="Loading reports…" />
        ) : (
          <FlatList
            data={queue ?? []}
            keyExtractor={(i) => `${i.target_type}:${i.target_id}`}
            contentContainerStyle={styles.content}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            ListEmptyComponent={
              <EmptyState
                icon="🛡️"
                title="All clear"
                message="No open reports to review right now."
              />
            }
            renderItem={({ item }) => <QueueRow item={item} onAct={act} />}
          />
        )
      ) : checks.isPending ? (
        <Loading label="Loading background checks…" />
      ) : checks.isError ? (
        <View style={styles.center}>
          <EmptyState
            icon="☁️"
            title="Could not load background checks"
            message={getErrorMessage(checks.error, 'Check your connection and try again.')}
          />
          <Button
            title="Try again"
            loading={checks.isFetching}
            onPress={() => void checks.refetch()}
          />
        </View>
      ) : (
        <FlatList
          data={checks.data}
          keyExtractor={(i) => i.user_id}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListHeaderComponent={
            <Text variant="small" muted style={styles.privacy}>
              Oldest first. These details are private: use them only to check who the applicant is
              and that the home suits a cat. Never copy, screenshot or share them.
            </Text>
          }
          ListEmptyComponent={
            <EmptyState
              icon="🏠"
              title="No one is waiting"
              message="New background checks appear here as adopters submit them."
            />
          }
          renderItem={({ item }) => <ScreeningReviewCard item={item} />}
        />
      )}
    </View>
  );
}

function TabButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.tab, selected && styles.tabSelected]}
    >
      <Text variant="smallStrong" color={selected ? colors.white : colors.textSecondary}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One applicant waiting for a decision. Approving clears them to adopt for 12
 * months; asking for more information or rejecting needs a note, which the
 * applicant sees on their background-check screen and is notified about.
 */
function ScreeningReviewCard({ item }: { item: ScreeningReviewItem }) {
  const review = useReviewScreening();
  const docs = useScreeningDocUrls(item.user_id, item.id_doc_paths);
  const [note, setNote] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const blockers = approvalBlockers(item);
  const name = item.full_name || item.username;

  const decide = async (decision: ScreeningDecision) => {
    const reason = note.trim();
    if (decision !== 'approved' && !reason) {
      notify(
        'Add a note for the applicant',
        decision === 'rejected'
          ? 'Tell them why, so they know whether anything can be corrected.'
          : 'Tell them exactly what to add or change.',
      );
      return;
    }
    const ok = await confirmAsync(
      decision === 'approved'
        ? {
            title: `Clear ${name} to adopt?`,
            message: `Only approve if the ID photo shows ${item.full_name}, born ${item.dob}. The clearance lasts 12 months.`,
            confirmLabel: 'Clear to adopt',
          }
        : decision === 'needs_review'
          ? {
              title: `Ask ${name} for more information?`,
              message: `They'll see: “${reason}”`,
              confirmLabel: 'Send',
            }
          : {
              title: `Reject ${name}'s background check?`,
              message: `They'll see: “${reason}”`,
              confirmLabel: 'Reject',
              destructive: true,
            },
    );
    if (!ok) return;
    review.mutate(
      { userId: item.user_id, decision, reason: decision === 'approved' ? undefined : reason },
      {
        onSuccess: () => setNote(''),
        onError: (e) => notify('Could not save the decision', getErrorMessage(e)),
      },
    );
  };

  const busy = review.isPending;

  return (
    <Card style={styles.row}>
      <View style={styles.rowTop}>
        <Pill
          label={item.status === 'needs_review' ? 'Flagged' : 'ID check'}
          fg={item.status === 'needs_review' ? colors.accentDark : colors.primaryDark}
          bg={item.status === 'needs_review' ? colors.accentSoft : colors.primaryTint}
        />
        <Text variant="caption" muted>
          @{item.username} · {timeAgo(item.submitted_at)}
        </Text>
      </View>

      <View>
        <Text variant="bodyStrong">{item.full_name}</Text>
        <Text variant="small" muted>
          Born {item.dob} (age {item.age}) · {item.city} {item.postal}
        </Text>
      </View>

      <View style={styles.facts}>
        <Text variant="small">{describeHome(item)}</Text>
        <Text variant="small">{describePets(item)}</Text>
        <Text variant="small">{describeCare(item)}</Text>
        {item.experience?.trim() ? (
          <Text variant="small" muted>
            “{item.experience.trim()}”
          </Text>
        ) : null}
      </View>

      {item.reasons.length > 0 ? (
        <View style={styles.flags}>
          <Text variant="overline" color={colors.accentDark}>
            Flags and earlier notes
          </Text>
          {item.reasons.map((r, i) => (
            <Text key={`${i}-${r}`} variant="small">
              • {r}
            </Text>
          ))}
        </View>
      ) : null}

      <Text variant="overline" color={colors.textSecondary}>
        ID photos
      </Text>
      {item.id_doc_paths.length === 0 ? (
        <Text variant="small" muted>
          None uploaded. Ask the applicant for a photo of their ID.
        </Text>
      ) : docs.isPending ? (
        <Text variant="small" muted>
          Loading ID photos…
        </Text>
      ) : docs.isError ? (
        <Button
          title="Could not load ID photos — try again"
          variant="ghost"
          size="sm"
          onPress={() => void docs.refetch()}
        />
      ) : (
        <ScrollView horizontal contentContainerStyle={styles.docs}>
          {(docs.data ?? []).map((url, i) => (
            <Pressable
              key={url}
              accessibilityRole="button"
              accessibilityLabel={`ID photo ${i + 1}, tap to ${expanded === url ? 'shrink' : 'enlarge'}`}
              onPress={() => setExpanded((cur) => (cur === url ? null : url))}
            >
              <Image
                source={{ uri: url }}
                contentFit="contain"
                style={[styles.doc, expanded === url && styles.docExpanded]}
              />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Input
        label="Note to the applicant"
        placeholder="Needed to ask for more information or to reject"
        multiline
        maxLength={300}
        value={note}
        onChangeText={setNote}
      />

      {blockers.length > 0 ? (
        <Text variant="small" color={colors.danger}>
          Can&apos;t approve yet: {blockers.join('; ')}.
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button
          title="Clear to adopt"
          size="sm"
          disabled={busy || blockers.length > 0}
          loading={busy && review.variables?.decision === 'approved'}
          onPress={() => void decide('approved')}
          style={styles.btn}
        />
        <Button
          title="Ask for more"
          variant="outline"
          size="sm"
          disabled={busy}
          loading={busy && review.variables?.decision === 'needs_review'}
          onPress={() => void decide('needs_review')}
          style={styles.btn}
        />
        <Button
          title="Reject"
          variant="ghost"
          size="sm"
          disabled={busy}
          loading={busy && review.variables?.decision === 'rejected'}
          onPress={() => void decide('rejected')}
          style={styles.btn}
        />
      </View>
    </Card>
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

  const runCopilot = () => {
    const type = item.target_type;
    // Narrow explicitly: ai-mod-copilot 400s on anything but these two.
    if (type !== 'sighting' && type !== 'comment') return;
    copilot.mutate(
      { targetType: type, targetId: item.target_id },
      {
        onError: (e) =>
          notify('AI summary unavailable', getErrorMessage(e, 'Please review this item manually.')),
      },
    );
  };

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
  page: { flex: 1, backgroundColor: colors.background },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.xs,
    backgroundColor: colors.background,
  },
  emoji: { fontSize: 52, marginBottom: spacing.xs },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  tab: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  content: { padding: spacing.lg, flexGrow: 1, backgroundColor: colors.background },
  privacy: { marginBottom: spacing.md },
  sep: { height: spacing.md },
  row: { gap: spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  facts: { gap: spacing.xs },
  flags: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
  },
  docs: { gap: spacing.sm },
  doc: {
    width: 220,
    height: 140,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
  },
  docExpanded: { width: 320, height: 420 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
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
