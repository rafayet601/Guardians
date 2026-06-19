import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { MapView, Marker, Circle, MAP_PROVIDER } from '@/components/PlatformMap';
import { StatusPill } from '@/components/StatusPill';
import { Avatar, Button, Card, Input, Loading, Pill, Text } from '@/components/ui';
import { NEXT_STATUSES, STATUS_META, TEMPERAMENT_META } from '@/constants/status';
import { useAdoptionInterest, useApproveAdoption, useExpressInterest } from '@/hooks/useAdoption';
import {
  useClaimSighting,
  usePostComment,
  useSighting,
  useSightingUpdates,
  useUpdateStatus,
} from '@/hooks/useSightings';
import { confirmAsync, notify } from '@/lib/dialog';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, radius, spacing } from '@/theme';
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

  const [comment, setComment] = useState('');

  if (isLoading || !sighting) return <Loading label="Loading…" />;

  const isOwner = !!user && user.id === sighting.reporter_id;
  const isClaimer = !!user && user.id === sighting.claimed_by;
  const canManage = isOwner || isClaimer;
  const meta = STATUS_META[sighting.status];
  const temp = TEMPERAMENT_META[sighting.temperament];
  const heroPhoto = sighting.photos?.[0]?.url;
  const nextStatuses = canManage ? NEXT_STATUSES[sighting.status] ?? [] : [];
  const myInterest = interests.find((i) => i.user_id === user?.id);

  const onClaim = () =>
    claim.mutate(sighting.id, {
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
      { onError: (e) => notify('Could not update', errMsg(e)) },
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

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <Animated.View entering={FadeIn.duration(motion.enter)}>
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
            entering={FadeInDown.delay(0 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
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
              <Pill label={`${temp.icon} ${temp.label}`} fg={colors.textSecondary} bg={colors.divider} />
              {sighting.is_injured ? <Pill label="🩹 Injured" fg={colors.danger} bg={colors.accentSoft} /> : null}
            </View>
            <Text variant="small" muted>
              {meta.description}
            </Text>
          </Animated.View>

          {/* Description */}
          {sighting.description ? (
            <Animated.View
              entering={FadeInDown.delay(1 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
            >
              <Card style={styles.section}>
                <Text variant="body">{sighting.description}</Text>
              </Card>
            </Animated.View>
          ) : null}

          {/* Reporter */}
          {sighting.reporter ? (
            <Animated.View
              entering={FadeInDown.delay(2 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
              style={styles.reporterRow}
            >
              <Avatar url={sighting.reporter.avatar_url} name={sighting.reporter.username} size={36} />
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
            entering={FadeInDown.delay(3 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
          >
            <View style={styles.mapWrap}>
              <MapView
                provider={MAP_PROVIDER}
                style={styles.map}
                pointerEvents="none"
                initialRegion={regionForRadius(sighting.lat, sighting.lng, sighting.is_precise ? 500 : 700)}
              >
                {sighting.is_precise ? (
                  <Marker coordinate={{ latitude: sighting.lat, longitude: sighting.lng }} />
                ) : (
                  <Circle
                    center={{ latitude: sighting.lat, longitude: sighting.lng }}
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

          {/* Actions */}
          <Animated.View
            entering={FadeInDown.delay(4 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
            style={styles.actions}
          >
            {sighting.status === 'spotted' ? (
              <Button
                title="🦸 Claim this rescue"
                size="lg"
                fullWidth
                loading={claim.isPending}
                onPress={onClaim}
              />
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
                <Pill label="✓ You applied to adopt" fg={colors.primary} bg={colors.primarySoft} style={styles.appliedPill} />
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

          {/* Adoption applicants (for the lister) */}
          {sighting.status === 'available' && canManage ? (
            <Animated.View
              entering={FadeInDown.delay(5 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
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
                      <Button title="Approve" size="sm" onPress={() => onApprove(i.id, i.applicant?.username)} />
                    )}
                  </Card>
                ))
              )}
            </Animated.View>
          ) : null}

          {/* Timeline */}
          <Animated.View
            entering={FadeInDown.delay(6 * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
            style={styles.section}
          >
            <Text variant="heading">Activity</Text>
            {updates.map((u, i) => (
              <Animated.View
                key={u.id}
                entering={FadeInDown.delay(Math.min(i, 8) * motion.stagger).duration(motion.enter).springify().damping(motion.damping)}
              >
                <TimelineItem update={u} />
              </Animated.View>
            ))}
          </Animated.View>
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
        >
          <Ionicons name="send" size={20} color={colors.white} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
  return e instanceof Error ? e.message : 'Please try again.';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xxxl },
  hero: { width: '100%', height: 280, backgroundColor: colors.primaryTint },
  heroFallback: { alignItems: 'center', justifyContent: 'center' },
  heroEmoji: { fontSize: 96 },
  body: { padding: spacing.lg, gap: spacing.md, marginTop: -spacing.xl, backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  headBlock: { gap: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  urgent: { fontSize: 24 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  section: { gap: spacing.sm, marginTop: spacing.sm },
  reporterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mapWrap: { height: 160, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  map: { flex: 1 },
  mapNote: { marginTop: spacing.xs },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
  appliedPill: { alignSelf: 'center' },
  applicantRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  commentRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, alignItems: 'flex-start' },
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
