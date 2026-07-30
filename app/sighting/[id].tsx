import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { PressableScale } from '@/components/PressableScale';
import { JourneyTimeline } from '@/components/JourneyTimeline';
import { MapView, Marker, Circle, MAP_PROVIDER } from '@/components/PlatformMap';
import { ReidSuggestions } from '@/components/ReidSuggestions';
import { RescueCopilot } from '@/components/RescueCopilot';
import { StatusPill } from '@/components/StatusPill';
import { Avatar, Button, Card, Input, Loading, Pill, Text } from '@/components/ui';
import { AI_FEATURES } from '@/constants/ai';
import { CLAIM_TO_RESCUE_TOTAL } from '@/constants/points';
import { NEXT_STATUSES, STATUS_META, TEMPERAMENT_META } from '@/constants/status';
import { useAdoptionInterest, useApproveAdoption, useExpressInterest } from '@/hooks/useAdoption';
import { useAiAdoptionCopy } from '@/hooks/useAiAdoptionCopy';
import { useBlockUser, useReportContent } from '@/hooks/useModeration';
import {
  useClaimSighting,
  usePostComment,
  useSighting,
  useSightingUpdates,
  useUpdateDescription,
  useUpdateStatus,
} from '@/hooks/useSightings';
import { confirmAsync, notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, palette, radius, spacing } from '@/theme';
import type { CatStatus, SightingUpdate } from '@/types/models';
import { regionForRadius } from '@/utils/geo';
import { timeAgo } from '@/utils/format';

export default function SightingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const { data: sighting, isLoading } = useSighting(id);
  const { data: updates = [] } = useSightingUpdates(id);
  const { data: interests = [] } = useAdoptionInterest(id);

  const claim = useClaimSighting();
  const updateStatus = useUpdateStatus();
  const expressInterest = useExpressInterest(id);
  const approveAdoption = useApproveAdoption(id);
  const postComment = usePostComment(id);
  const report = useReportContent();
  const block = useBlockUser();

  const reduced = useReducedMotion() ?? false;
  const [comment, setComment] = useState('');

  if (isLoading || !sighting) return <Loading label="Loading…" />;

  const isOwner = !!user && user.id === sighting.reporter_id;
  const isClaimer = !!user && user.id === sighting.claimed_by;
  const canManage = isOwner || isClaimer;
  const canDraftListing = AI_FEATURES.adoptionCopy && sighting.status === 'available' && canManage;
  const meta = STATUS_META[sighting.status];
  const temp = TEMPERAMENT_META[sighting.temperament];
  const heroPhoto = sighting.photos?.[0]?.url;
  const nextStatuses = canManage ? (NEXT_STATUSES[sighting.status] ?? []) : [];
  const myInterest = interests.find((i) => i.user_id === user?.id);

  const onClaim = () =>
    claim.mutate(sighting.id, {
      onSuccess: () =>
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
      onError: (e) => notify('Could not claim', errMsg(e)),
    });

  const onAdvance = async (status: CatStatus) => {
    const isClose = status === 'archived';
    const ok = await confirmAsync({
      title: isClose ? 'Close this report?' : `Mark as "${STATUS_META[status].label}"?`,
      confirmLabel: isClose ? 'Close' : 'Confirm',
      destructive: isClose,
    });
    if (!ok) return;
    updateStatus.mutate(
      { id: sighting.id, status },
      {
        onSuccess: () =>
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
        onError: (e) => notify('Could not update', errMsg(e)),
      },
    );
  };

  const onAdopt = () =>
    expressInterest.mutate(undefined, {
      onSuccess: () => notify('Interest sent! 🎉', 'The lister will review your request.'),
      onError: (e) => notify('Could not send', errMsg(e)),
    });

  const onApprove = async (interestId: string, username?: string) => {
    const ok = await confirmAsync({
      title: `Approve ${username ?? 'this adopter'}?`,
      message: 'This cat will be marked as adopted.',
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    approveAdoption.mutate(interestId, {
      onError: (e) => notify('Could not approve', errMsg(e)),
    });
  };

  const onComment = () => {
    const body = comment.trim();
    if (!body) return;
    postComment.mutate(body, {
      onSuccess: () => setComment(''),
      onError: (e) => notify('Could not post', errMsg(e)),
    });
  };

  const onReportListing = async () => {
    const ok = await confirmAsync({
      title: 'Report this listing?',
      message: 'Our team will review it for inappropriate, false, or duplicate content.',
      confirmLabel: 'Report',
      destructive: true,
    });
    if (!ok) return;
    report.mutate(
      { type: 'sighting', id: sighting.id },
      {
        onSuccess: () => notify('Thanks for reporting', 'Our team will take a look.'),
        onError: (e) => notify('Could not report', errMsg(e)),
      },
    );
  };

  const onBlockReporter = async () => {
    if (!sighting.reporter_id) return;
    const ok = await confirmAsync({
      title: `Block ${sighting.reporter?.username ?? 'this user'}?`,
      message: "You won't see their reports anymore. You can unblock them later from Settings.",
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return;
    block.mutate(sighting.reporter_id, {
      onSuccess: () => notify('User blocked', "You won't see this person's reports."),
      onError: (e) => notify('Could not block', errMsg(e)),
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <Animated.View entering={reduced ? FadeIn.duration(0) : FadeIn.duration(motion.enter)}>
          {heroPhoto ? (
            <Image source={{ uri: heroPhoto }} style={styles.hero} contentFit="cover" />
          ) : (
            <View style={[styles.hero, styles.heroFallback]}>
              <Text style={styles.heroEmoji}>{temp.icon}</Text>
            </View>
          )}
        </Animated.View>

        <View style={styles.body}>
          {/* Title + status + summary */}
          <Animated.View
            entering={
              reduced
                ? FadeInDown.duration(0)
                : FadeInDown.delay(0 * motion.stagger)
                    .duration(motion.enter)
                    .springify()
                    .damping(motion.damping)
            }
            style={styles.headBlock}
          >
            <View style={styles.titleRow}>
              <Text variant="title" style={styles.flex}>
                {sighting.title?.trim() || 'Cat sighting'}
              </Text>
              {sighting.needs_urgent_help ? <Text style={styles.urgent}>🚨</Text> : null}
            </View>
            <View style={styles.metaRow}>
              <StatusPill status={sighting.status} />
              <Pill
                label={`${temp.icon} ${temp.label}`}
                fg={colors.textSecondary}
                bg={colors.divider}
              />
              {sighting.is_injured ? (
                <Pill label="🩹 Injured" fg={colors.urgent} bg={colors.urgentSoft} />
              ) : null}
            </View>
            <Text variant="small" muted>
              {meta.description}
            </Text>
          </Animated.View>

          {/* Description */}
          {sighting.description ? (
            <Animated.View
              entering={
                reduced
                  ? FadeInDown.duration(0)
                  : FadeInDown.delay(1 * motion.stagger)
                      .duration(motion.enter)
                      .springify()
                      .damping(motion.damping)
              }
            >
              <Card style={styles.section}>
                <Text variant="body">{sighting.description}</Text>
              </Card>
            </Animated.View>
          ) : null}

          {/* Reporter */}
          {sighting.reporter ? (
            <Animated.View
              entering={
                reduced
                  ? FadeInDown.duration(0)
                  : FadeInDown.delay(2 * motion.stagger)
                      .duration(motion.enter)
                      .springify()
                      .damping(motion.damping)
              }
              style={styles.reporterRow}
            >
              <Avatar
                url={sighting.reporter.avatar_url}
                name={sighting.reporter.username}
                size={36}
              />
              <Text variant="small" muted>
                Reported by{' '}
                <Text variant="smallStrong" color={colors.text}>
                  {sighting.reporter.username}
                </Text>{' '}
                · {timeAgo(sighting.created_at)}
              </Text>
            </Animated.View>
          ) : null}

          {/* Map — exact pin for the rescue coordinators, an approximate area
              for everyone else (privacy; see get_sighting_detail RPC). */}
          <Animated.View
            entering={
              reduced
                ? FadeInDown.duration(0)
                : FadeInDown.delay(3 * motion.stagger)
                    .duration(motion.enter)
                    .springify()
                    .damping(motion.damping)
            }
          >
            <View style={styles.mapWrap}>
              <MapView
                provider={MAP_PROVIDER}
                style={[styles.map, { pointerEvents: 'none' }]}
                initialRegion={regionForRadius(
                  sighting.lat ?? 0,
                  sighting.lng ?? 0,
                  sighting.is_precise ? 500 : 700,
                )}
              >
                {sighting.is_precise ? (
                  <Marker
                    coordinate={{ latitude: sighting.lat ?? 0, longitude: sighting.lng ?? 0 }}
                  />
                ) : (
                  <Circle
                    center={{ latitude: sighting.lat ?? 0, longitude: sighting.lng ?? 0 }}
                    radius={160}
                    strokeColor={colors.primary}
                    strokeWidth={2}
                    fillColor={colors.primarySoft}
                  />
                )}
              </MapView>
            </View>
            {!sighting.is_precise ? (
              <Text variant="caption" muted style={styles.mapNote}>
                📍 Approximate area — the exact location is shared only with the rescuer.
              </Text>
            ) : null}
          </Animated.View>

          {/* 🐈 Possible duplicates (AI-M3 #4). Only the reporter/guardian sees
              (and can act on) re-ID suggestions — the query is disabled for
              everyone else, matching the edge function's access rule. Never
              auto-merges; each candidate is confirmed/rejected by a human. */}
          <ReidSuggestions sightingId={sighting.id} canManage={canManage} />

          {/* Actions */}
          <Animated.View
            entering={
              reduced
                ? FadeInDown.duration(0)
                : FadeInDown.delay(4 * motion.stagger)
                    .duration(motion.enter)
                    .springify()
                    .damping(motion.damping)
            }
            style={styles.actions}
          >
            {sighting.status === 'spotted' ? (
              <>
                <View style={styles.rewardCard}>
                  <View style={styles.rewardIcon}>
                    <Ionicons name="star" size={16} color={colors.white} />
                  </View>
                  <View style={styles.flex}>
                    <Text variant="smallStrong" color={colors.accentDark}>
                      Earn {CLAIM_TO_RESCUE_TOTAL} points
                    </Text>
                    <Text variant="caption" color={colors.accentDark} style={styles.rewardSub}>
                      for completing this rescue
                    </Text>
                  </View>
                </View>
                <Button
                  title="🦸 Claim this rescue"
                  size="lg"
                  fullWidth
                  loading={claim.isPending}
                  onPress={onClaim}
                />
              </>
            ) : null}

            {nextStatuses.map((status) => (
              <Button
                key={status}
                title={
                  status === 'archived'
                    ? 'Close report'
                    : `${STATUS_META[status].icon} Mark as ${STATUS_META[status].label}`
                }
                variant={status === 'archived' ? 'outline' : 'primary'}
                fullWidth
                loading={updateStatus.isPending}
                onPress={() => onAdvance(status)}
              />
            ))}

            {sighting.status === 'available' && !canManage ? (
              myInterest ? (
                <Pill
                  label="✓ You applied to adopt"
                  fg={colors.primary}
                  bg={colors.primarySoft}
                  style={styles.appliedPill}
                />
              ) : (
                <Button
                  title="🏠 I want to adopt"
                  variant="secondary"
                  size="lg"
                  fullWidth
                  loading={expressInterest.isPending}
                  onPress={onAdopt}
                />
              )
            ) : null}
          </Animated.View>

          {/* 🗺️ Journey timeline (AI-M4 #6): shown once ≥2 sightings are
              confirmed-linked as the same cat. Reporter/guardian only — the
              get_sighting_links RPC restricts links to them. */}
          <JourneyTimeline sightingId={sighting.id} canManage={canManage} />

          {/* 🧭 Rescue copilot (AI-M5 #7): RAG-grounded trapping/transport
              guidance for the assigned guardian only (server re-checks
              claimed_by). Defers rather than guessing when the KB has no
              close match; never veterinary advice. */}
          <RescueCopilot sightingId={sighting.id} isClaimer={isClaimer} />

          {/* Adoption applicants (for the lister) */}
          {sighting.status === 'available' && canManage ? (
            <Animated.View
              entering={
                reduced
                  ? FadeInDown.duration(0)
                  : FadeInDown.delay(5 * motion.stagger)
                      .duration(motion.enter)
                      .springify()
                      .damping(motion.damping)
              }
              style={styles.section}
            >
              <Text variant="heading">Adoption requests ({interests.length})</Text>
              {interests.length === 0 ? (
                <Text variant="small" muted>
                  No one has applied yet.
                </Text>
              ) : (
                interests.map((i) => (
                  <Card key={i.id} style={styles.applicantRow}>
                    <Avatar url={i.applicant?.avatar_url} name={i.applicant?.username} size={40} />
                    <View style={styles.flex}>
                      <Text variant="bodyStrong">{i.applicant?.username ?? 'Someone'}</Text>
                      {i.message ? (
                        <Text variant="small" muted>
                          {i.message}
                        </Text>
                      ) : null}
                    </View>
                    {i.status === 'approved' ? (
                      <Pill label="Approved" fg={colors.primary} bg={colors.primarySoft} />
                    ) : (
                      <Button
                        title="Approve"
                        size="sm"
                        onPress={() => onApprove(i.id, i.applicant?.username)}
                      />
                    )}
                  </Card>
                ))
              )}
            </Animated.View>
          ) : null}

          {/* ✨ AI adoption-listing draft (AI-M1 #13). Hidden unless the feature
              flag is on, the cat is ready to adopt, and the viewer is the
              reporter/assigned guardian. Produces an EDITABLE draft from the
              sighting's real timeline — never auto-published. */}
          {canDraftListing ? (
            <Animated.View
              entering={
                reduced
                  ? FadeInDown.duration(0)
                  : FadeInDown.delay(5.5 * motion.stagger)
                      .duration(motion.enter)
                      .springify()
                      .damping(motion.damping)
              }
            >
              <AdoptionDraftCard sightingId={sighting.id} canSave={isOwner} />
            </Animated.View>
          ) : null}

          {/* Timeline */}
          <Animated.View
            entering={
              reduced
                ? FadeInDown.duration(0)
                : FadeInDown.delay(6 * motion.stagger)
                    .duration(motion.enter)
                    .springify()
                    .damping(motion.damping)
            }
            style={styles.section}
          >
            <Text variant="heading">Activity</Text>
            {updates.map((u, i) => (
              <Animated.View
                key={u.id}
                entering={
                  reduced
                    ? FadeInDown.duration(0)
                    : FadeInDown.delay(Math.min(i, 8) * motion.stagger)
                        .duration(motion.enter)
                        .springify()
                        .damping(motion.damping)
                }
              >
                <TimelineItem update={u} />
              </Animated.View>
            ))}
          </Animated.View>

          {!isOwner ? (
            <View style={styles.modRow}>
              <Pressable
                onPress={onReportListing}
                hitSlop={8}
                style={styles.modAction}
                accessibilityRole="button"
                accessibilityLabel="Report this listing"
              >
                <Text variant="small" color={colors.textMuted}>
                  ⚠️ Report this listing
                </Text>
              </Pressable>
              {sighting.reporter_id ? (
                <Pressable
                  onPress={onBlockReporter}
                  hitSlop={8}
                  style={styles.modAction}
                  accessibilityRole="button"
                  accessibilityLabel="Block this user"
                >
                  <Text variant="small" color={colors.textMuted}>
                    🚫 Block this user
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Comment composer */}
      <View style={styles.composer}>
        <Input
          placeholder="Add an update or comment…"
          value={comment}
          onChangeText={setComment}
          style={styles.composerInput}
          multiline
        />
        <Pressable
          onPress={onComment}
          disabled={!comment.trim() || postComment.isPending}
          style={[styles.send, (!comment.trim() || postComment.isPending) && styles.sendDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Send comment"
          accessibilityState={{ disabled: !comment.trim() || postComment.isPending }}
        >
          <Ionicons name="send" size={20} color={colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * Adoption-listing draft affordance (AI-M1 #13). Tapping "Draft adoption
 * listing" asks the `ai-adoption-copy` Edge Function to write a warm,
 * community-voiced draft from the sighting's real timeline. The draft lands in
 * an editable field; the reporter reviews, tweaks, and saves it as the listing
 * description via the existing update path. Never auto-published — the guardian
 * (non-reporter) can generate/edit a draft but only the reporter can save.
 */
function AdoptionDraftCard({ sightingId, canSave }: { sightingId: string; canSave: boolean }) {
  const draftCopy = useAiAdoptionCopy();
  const saveDescription = useUpdateDescription();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);

  const onGenerate = async () => {
    try {
      const { draft } = await draftCopy.mutateAsync(sightingId);
      setText(draft);
      setOpen(true);
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    } catch (e) {
      notify('Draft unavailable', errMsg(e));
    }
  };

  const onSave = () => {
    const body = text.trim();
    if (!body) return;
    saveDescription.mutate(
      { id: sightingId, description: body },
      {
        onSuccess: () => {
          setOpen(false);
          notify('Listing updated ✨', 'Your adoption listing has been saved.');
        },
        onError: (e) => notify('Could not save', errMsg(e)),
      },
    );
  };

  return (
    <Card style={styles.draftCard}>
      <View style={styles.draftHead}>
        <Text variant="bodyStrong">✨ Draft the adoption listing</Text>
        <Text variant="small" muted>
          We&apos;ll write a warm first draft from this cat&apos;s rescue story — you review and
          edit every word before it&apos;s saved.
        </Text>
      </View>

      <PressableScale
        onPress={onGenerate}
        disabled={draftCopy.isPending}
        style={styles.draftBtn}
        accessibilityRole="button"
        accessibilityLabel="Draft adoption listing"
      >
        <Ionicons name="sparkles" size={16} color={colors.primary} />
        <Text variant="smallStrong" color={colors.primary}>
          {draftCopy.isPending
            ? 'Writing a draft…'
            : open
              ? 'Rewrite draft'
              : 'Draft adoption listing'}
        </Text>
      </PressableScale>

      {open ? (
        <>
          <Input value={text} onChangeText={setText} multiline style={styles.draftInput} />
          <Text variant="caption" muted>
            AI-drafted from this cat&apos;s real timeline — please review and edit before saving.
          </Text>
          {canSave ? (
            <Button
              title="Save as listing"
              fullWidth
              loading={saveDescription.isPending}
              onPress={onSave}
            />
          ) : (
            <Text variant="small" muted>
              You can copy this draft to share — only the reporter can save it to the listing.
            </Text>
          )}
        </>
      ) : null}
    </Card>
  );
}

function TimelineItem({ update }: { update: SightingUpdate }) {
  if (update.type === 'comment') {
    return (
      <View style={styles.commentRow}>
        <Avatar url={update.author?.avatar_url} name={update.author?.username} size={32} />
        <View style={styles.flex}>
          <Text variant="smallStrong">
            {update.author?.username ?? 'Someone'}{' '}
            <Text variant="caption" muted>
              · {timeAgo(update.created_at)}
            </Text>
          </Text>
          <Text variant="body">{update.body}</Text>
        </View>
      </View>
    );
  }

  // status_change / claim / system → centered system line
  const icon = update.new_status ? STATUS_META[update.new_status].icon : 'ℹ️';
  const text =
    update.body ??
    (update.new_status ? `Marked as ${STATUS_META[update.new_status].label}` : 'Update');
  return (
    <View style={styles.systemRow}>
      <Text variant="small" muted center>
        {icon} {text} · {timeAgo(update.created_at)}
      </Text>
    </View>
  );
}

function errMsg(e: unknown): string {
  return getErrorMessage(e, 'Please try again.');
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xxxl },
  hero: { width: '100%', height: 280, backgroundColor: colors.primaryTint },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 96 },
  body: {
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: -spacing.xl,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  headBlock: { gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  urgent: { fontSize: 24 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  section: { gap: spacing.sm, marginTop: spacing.sm },
  reporterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mapWrap: {
    height: 160,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: { flex: 1 },
  mapNote: { marginTop: spacing.xs },
  modRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },
  modAction: { paddingVertical: spacing.xs },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  appliedPill: { alignSelf: 'center' },
  rewardCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: palette.amber100,
  },
  rewardIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardSub: { marginTop: 1 },
  applicantRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  draftCard: { gap: spacing.md, marginTop: spacing.sm },
  draftHead: { gap: spacing.xs },
  draftBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  draftInput: { minHeight: 120 },
  commentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignItems: 'flex-start',
  },
  systemRow: { alignItems: 'center', paddingVertical: spacing.sm },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  composerInput: { flex: 1, minHeight: 44, maxHeight: 120 },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
