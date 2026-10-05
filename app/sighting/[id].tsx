import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Celebration, type CelebrationMessage } from '@/components/Celebration';
import { PressableScale } from '@/components/PressableScale';
import { JourneyTimeline } from '@/components/JourneyTimeline';
import { ApplicantScreeningBadge } from '@/components/ScreeningBadge';
import { PermissionPrimer } from '@/components/PermissionPrimer';
import { MapView, Marker, Circle, MAP_PROVIDER } from '@/components/PlatformMap';
import { ReidSuggestions } from '@/components/ReidSuggestions';
import { RescueCopilot } from '@/components/RescueCopilot';
import { RescueProgress } from '@/components/RescueProgress';
import { StatusPill } from '@/components/StatusPill';
import { Avatar, Button, Card, EmptyState, Input, Loading, Pill, Text } from '@/components/ui';
import { AI_FEATURES } from '@/constants/ai';
import { CLAIM_TO_RESCUE_TOTAL, POINTS } from '@/constants/points';
import {
  STATUS_META,
  TEMPERAMENT_META,
  getStatusActions,
  isClaimStale,
  isUrgentNow,
  type StatusAction,
} from '@/constants/status';
import {
  useAdoptionInterest,
  useApproveAdoption,
  useDeclineAdoption,
  useExpressInterest,
  useWithdrawInterest,
} from '@/hooks/useAdoption';
import { useMyScreening } from '@/hooks/useScreening';
import { useAiAdoptionCopy } from '@/hooks/useAiAdoptionCopy';
import { useBlockUser, useReportContent } from '@/hooks/useModeration';
import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import { MAX_SIGHTING_PHOTOS, useAddSightingPhoto } from '@/hooks/useSightingPhotos';
import {
  useClaimSighting,
  usePostComment,
  useSighting,
  useSightingUpdates,
  useUpdateDescription,
  useUpdateStatus,
} from '@/hooks/useSightings';
import { confirmAsync, notify } from '@/lib/dialog';
import { requestPushPrompt } from '@/lib/pushPrompt';
import { getErrorMessage, isClaimLostError } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, palette, radius, spacing } from '@/theme';
import type { SightingUpdate } from '@/types/models';
import { isScreeningCleared } from '@/types/models';
import { directionsUrl, regionForRadius } from '@/utils/geo';
import { timeAgo } from '@/utils/format';
import { getDemoSightingPhoto } from '@/utils/demoSightings';
import { ADOPTION_REQUEST_META, getSightingGuidance } from '@/utils/sightingGuidance';

export default function SightingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const sightingQuery = useSighting(id);
  const updatesQuery = useSightingUpdates(id);
  const interestsQuery = useAdoptionInterest(id);
  const screeningQuery = useMyScreening();
  const { data: sighting, isLoading } = sightingQuery;
  const { data: updates = [] } = updatesQuery;
  const { data: interests = [] } = interestsQuery;

  const claim = useClaimSighting();
  const updateStatus = useUpdateStatus();
  const expressInterest = useExpressInterest(id);
  const approveAdoption = useApproveAdoption(id);
  const declineAdoption = useDeclineAdoption(id);
  const withdrawInterest = useWithdrawInterest(id);
  const postComment = usePostComment(id);
  const report = useReportContent();
  const block = useBlockUser();
  const picker = usePhotoPicker();
  const addSightingPhoto = useAddSightingPhoto(id);

  const reduced = useReducedMotion() ?? false;
  const [comment, setComment] = useState('');
  const [failedPhoto, setFailedPhoto] = useState<string | number | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [celebration, setCelebration] = useState<CelebrationMessage | null>(null);
  const dismissCelebration = useCallback(() => setCelebration(null), []);

  if (isLoading) return <Loading label="Loading report…" />;
  if (!sighting) {
    return (
      <ScrollView contentContainerStyle={styles.unavailable}>
        <EmptyState
          icon={sightingQuery.isError ? '☁️' : '🐾'}
          title={sightingQuery.isError ? 'Could not load this report' : 'Report unavailable'}
          message={
            sightingQuery.isError
              ? 'Check your connection and try again. The report may also no longer be available.'
              : 'This report may have been removed or may no longer be available to you.'
          }
        />
        {id ? (
          <Button
            title="Try again"
            loading={sightingQuery.isFetching}
            onPress={() => void sightingQuery.refetch()}
          />
        ) : null}
        <Button title="Back to map" variant="outline" onPress={() => router.replace('/(tabs)')} />
      </ScrollView>
    );
  }

  const isOwner = !!user && user.id === sighting.reporter_id;
  const isClaimer = !!user && user.id === sighting.claimed_by;
  const canManage = isOwner || isClaimer;
  const canDraftListing = AI_FEATURES.adoptionCopy && sighting.status === 'available' && canManage;
  const meta = STATUS_META[sighting.status];
  const temp = TEMPERAMENT_META[sighting.temperament];
  const photos = sighting.photos ?? [];
  const heroPhoto = photos[Math.min(photoIndex, Math.max(0, photos.length - 1))]?.url;
  const canAddPhoto = canManage && photos.length < MAX_SIGHTING_PHOTOS;
  const demoPhoto = getDemoSightingPhoto(sighting);
  const photo = heroPhoto || demoPhoto;
  const isDemoPhoto = !heroPhoto && !!demoPhoto;
  const myInterest = interests.find((i) => i.user_id === user?.id);
  const latestActivityAt = updates.reduce(
    (latest, update) => (update.created_at > latest ? update.created_at : latest),
    sighting.updated_at,
  );
  // A Guardian who claimed and went quiet must not strand the cat: the
  // reporter may reopen it once nothing has happened for a day.
  const claimStale =
    sighting.status === 'claimed' && isClaimStale(sighting.claimed_at, latestActivityAt);
  const statusActions = getStatusActions(sighting.status, { isOwner, isClaimer, claimStale });
  const guidance = getSightingGuidance(sighting, user?.id, { claimStale });
  const urgentNow = isUrgentNow(sighting.status, sighting.needs_urgent_help);
  const canNavigate =
    canManage && !!sighting.is_precise && sighting.lat != null && sighting.lng != null;

  const onClaim = async () => {
    // Claiming is a commitment other Guardians will rely on, so say what it
    // means (and that there is a way out) before it happens.
    const ok = await confirmAsync({
      title: isOwner ? 'Rescue this cat yourself?' : 'Claim this rescue?',
      message:
        "Claiming lets the community know you're coordinating this rescue. You'll see its exact location and can post updates in Activity. If you can't follow through, you can release it from this screen so another Guardian can step in.",
      confirmLabel: 'Claim rescue',
    });
    if (!ok) return;
    claim.mutate(sighting.id, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setCelebration({
          title: "You're the Guardian! 🦸",
          message: `+${POINTS.claim} points. Post an update in Activity so the reporter knows you're on it.`,
        });
        // After the celebration has had its moment, offer alerts for the next cat.
        requestPushPrompt('claim', 3500);
      },
      onError: (e) =>
        isClaimLostError(e)
          ? notify(
              'Another Guardian got there first',
              'Thank you for jumping in. This cat already has a Guardian. Check the map for other cats who still need help.',
            )
          : notify('Could not claim', errMsg(e)),
    });
  };

  const onAction = async (action: StatusAction) => {
    const ok = await confirmAsync({
      title: action.confirmTitle,
      message: action.confirmMessage,
      confirmLabel: action.confirmLabel,
      destructive: action.destructive,
    });
    if (!ok) return;
    updateStatus.mutate(
      { id: sighting.id, status: action.status, note: action.note },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          // Only the Guardian who saw it through earns the rescue points.
          if (action.status === 'safe') {
            setCelebration({
              title: 'Rescue complete 💚',
              message: isClaimer
                ? `+${POINTS.rescue} points. Thank you for bringing this cat to safety.`
                : 'Thank you for looking out for this cat.',
            });
          }
        },
        onError: (e) => notify('Could not update', errMsg(e)),
      },
    );
  };

  // Up to four photos per pick, uploaded one after another so a failure stops
  // at the photo that failed and says so, rather than half-succeeding silently.
  const onAddPhoto = async () => {
    const room = Math.min(4, MAX_SIGHTING_PHOTOS - photos.length);
    const assets = await picker.pick(room);
    for (const asset of assets) {
      try {
        await addSightingPhoto.mutateAsync({
          uri: asset.uri,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          base64: asset.base64,
        });
      } catch (e) {
        notify('Could not add photo', errMsg(e));
        return;
      }
    }
    if (assets.length > 0) setPhotoIndex(photos.length); // show the first new one
  };

  const onDirections = async () => {
    const url =
      sighting.lat != null && sighting.lng != null
        ? directionsUrl(sighting.lat, sighting.lng, Platform.OS)
        : null;
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      notify(
        'Could not open maps',
        `Open your maps app and search for ${sighting.lat?.toFixed(5)}, ${sighting.lng?.toFixed(5)}.`,
      );
    }
  };

  const onAdopt = async () => {
    // Background-check hard gate (UI hint — the RPC enforces it server-side).
    if (!screeningQuery.isPending && !isScreeningCleared(screeningQuery.data)) {
      const ok = await confirmAsync({
        title: 'Background check required',
        message:
          'Adopters need a cleared background check first. Our team reviews each one by hand, which can take a few days, and a check is valid for 12 months.',
        confirmLabel: 'Start screening',
      });
      if (ok) router.push('/adopt/screening');
      return;
    }
    expressInterest.mutate(undefined, {
      onSuccess: () => {
        notify('Interest sent! 🎉', 'The lister will review your request.');
        // They are now waiting on someone else's answer.
        requestPushPrompt('adopt', 1200);
      },
      onError: (e) => notify('Could not send', getErrorMessage(e)),
    });
  };

  const onWithdraw = async () => {
    const ok = await confirmAsync({
      title: 'Withdraw your request?',
      message:
        'The lister will no longer see it. You can ask again while this cat is still looking for a home.',
      confirmLabel: 'Withdraw',
      destructive: true,
    });
    if (!ok) return;
    withdrawInterest.mutate(undefined, {
      onError: (e) => notify('Could not withdraw', errMsg(e)),
    });
  };

  const onDecline = async (interestId: string, username?: string) => {
    const ok = await confirmAsync({
      title: `Decline ${username ?? 'this request'}?`,
      message:
        "They'll be told the request wasn't accepted, and they can't send another one for this cat.",
      confirmLabel: 'Decline',
      destructive: true,
    });
    if (!ok) return;
    declineAdoption.mutate(interestId, {
      onError: (e) => notify('Could not decline', errMsg(e)),
    });
  };

  const onApprove = async (interestId: string, username?: string) => {
    const ok = await confirmAsync({
      title: `Approve ${username ?? 'this adopter'}?`,
      message: 'This cat will be marked as adopted.',
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    approveAdoption.mutate(interestId, {
      onSuccess: () =>
        setCelebration({
          title: 'Adopted! 🎉',
          message: `Thank you for finding this cat a forever home. +${POINTS.place} points. Arrange the handover with ${username ?? 'the adopter'} in the comments below.`,
        }),
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
      onSuccess: () => {
        notify('User blocked', "You won't see this person's reports.");
        // Their report is now hidden everywhere, so don't leave it open here.
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)');
      },
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
          {photo && failedPhoto !== photo ? (
            <Image
              source={heroPhoto ? { uri: heroPhoto } : demoPhoto}
              style={styles.hero}
              contentFit="cover"
              onError={() => setFailedPhoto(photo)}
              accessibilityLabel={`${isDemoPhoto ? 'AI-generated demo photo: ' : ''}${sighting.title?.trim() || 'Reported cat'}`}
            />
          ) : (
            <View style={[styles.hero, styles.heroFallback]}>
              <Ionicons name="paw-outline" size={64} color={colors.primaryDark} />
              <Text variant="small" muted>
                No photo yet
              </Text>
            </View>
          )}
          {isDemoPhoto && failedPhoto !== photo && (
            <View style={styles.demoLabel}>
              <Pill label="Demo photo" fg={colors.primaryDark} bg={colors.surface} />
            </View>
          )}
        </Animated.View>

        <View style={styles.body}>
          {photos.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.gallery}
              accessibilityLabel="Photos of this cat"
            >
              {photos.map((ph, i) => {
                const active = i === Math.min(photoIndex, photos.length - 1);
                return (
                  <Pressable
                    key={ph.id}
                    onPress={() => {
                      setFailedPhoto(null);
                      setPhotoIndex(i);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Photo ${i + 1} of ${photos.length}`}
                    accessibilityState={{ selected: active }}
                  >
                    <Image
                      source={{ uri: ph.url }}
                      style={[styles.galleryThumb, active && styles.galleryThumbActive]}
                      contentFit="cover"
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

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
              {urgentNow ? (
                <Text style={styles.urgent} accessibilityLabel="Urgent">
                  🚨
                </Text>
              ) : null}
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

          <RescueProgress status={sighting.status} canManage={canManage} />
          <Card style={styles.caseSummary}>
            <Text variant="smallStrong" color={colors.primary}>
              {guidance.responsibility}
            </Text>
            <Text variant="bodyStrong">What happens next</Text>
            <Text variant="small" muted>
              {guidance.nextStep}
            </Text>
            <Text variant="caption" muted>
              Last recorded activity · {timeAgo(latestActivityAt)}
            </Text>
          </Card>
          {sightingQuery.isError ? (
            <QueryFailure
              message="This report could not be refreshed. Showing the last loaded details."
              loading={sightingQuery.isFetching}
              onRetry={() => void sightingQuery.refetch()}
            />
          ) : null}

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

          {canAddPhoto ? (
            <View style={styles.addPhoto}>
              <Button
                title={photos.length === 0 ? '📷 Add a photo' : '📷 Add another photo'}
                variant="outline"
                size="sm"
                loading={picker.picking || addSightingPhoto.isPending}
                onPress={onAddPhoto}
                accessibilityHint="Choose or take photos to add to this report"
              />
              {sighting.status === 'safe' || sighting.status === 'available' ? (
                <Text variant="caption" muted>
                  A clear photo of the cat in care helps adopters.
                </Text>
              ) : null}
            </View>
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
                📍 Approximate area — the exact location is shared with the reporter and assigned
                guardian.
              </Text>
            ) : (
              <Text variant="caption" muted style={styles.mapNote}>
                📍 Exact location — only the reporter and assigned guardian can see this.
              </Text>
            )}
            {canNavigate ? (
              <Button
                title="🧭 Get directions"
                variant="outline"
                fullWidth
                onPress={onDirections}
                accessibilityHint="Opens your maps app with directions to the cat"
                style={styles.directions}
              />
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
            {sighting.status === 'spotted' && isOwner ? (
              <>
                {/* The reporter's own report: reassure them it is live rather than
                    pitching them a claim promo, but keep "I'll do it myself". */}
                <View style={styles.liveCard} accessibilityRole="summary">
                  <View style={styles.liveIcon}>
                    <Ionicons name="checkmark" size={18} color={colors.white} />
                  </View>
                  <View style={styles.flex}>
                    <Text variant="bodyStrong">Your report is live</Text>
                    <Text variant="small" muted>
                      Guardians near this spot can see this cat on the map. You&apos;ll get a
                      notification when one claims it, as long as alerts are on in Settings.
                      {sighting.needs_urgent_help
                        ? ' Because it is marked urgent, Guardians nearby with alerts on were also sent a push.'
                        : ''}
                    </Text>
                  </View>
                </View>
                <Button
                  title="🦸 I'll rescue this cat myself"
                  variant="outline"
                  fullWidth
                  loading={claim.isPending}
                  onPress={onClaim}
                />
              </>
            ) : null}

            {sighting.status === 'spotted' && !isOwner ? (
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

            {statusActions.map((action) => (
              <Button
                key={action.status}
                title={action.label}
                variant={action.variant}
                fullWidth
                loading={updateStatus.isPending && updateStatus.variables?.status === action.status}
                disabled={updateStatus.isPending}
                onPress={() => onAction(action)}
              />
            ))}

            {(sighting.status === 'available' || sighting.status === 'adopted') && !canManage ? (
              interestsQuery.isPending ? (
                <Text variant="small" muted>
                  Checking your adoption request…
                </Text>
              ) : interestsQuery.isError ? (
                <QueryFailure
                  message="Could not check your adoption request."
                  loading={interestsQuery.isFetching}
                  onRetry={() => void interestsQuery.refetch()}
                />
              ) : myInterest ? (
                <Card style={styles.caseSummary}>
                  <Text variant="bodyStrong">{ADOPTION_REQUEST_META[myInterest.status].label}</Text>
                  <Text variant="small" muted>
                    {ADOPTION_REQUEST_META[myInterest.status].description}
                  </Text>
                  {myInterest.status === 'pending' && sighting.status === 'available' ? (
                    <Button
                      title="Withdraw request"
                      variant="outline"
                      size="sm"
                      loading={withdrawInterest.isPending}
                      onPress={onWithdraw}
                      style={styles.caseAction}
                    />
                  ) : myInterest.status === 'withdrawn' && sighting.status === 'available' ? (
                    <Button
                      title="Ask to adopt again"
                      variant="secondary"
                      size="sm"
                      loading={expressInterest.isPending}
                      onPress={onAdopt}
                      style={styles.caseAction}
                    />
                  ) : null}
                </Card>
              ) : sighting.status === 'available' ? (
                <>
                  <Button
                    title="🏠 I want to adopt"
                    variant="secondary"
                    size="lg"
                    fullWidth
                    loading={expressInterest.isPending}
                    onPress={onAdopt}
                  />
                  {screeningQuery.isSuccess ? (
                    <Text variant="small" muted>
                      {isScreeningCleared(screeningQuery.data)
                        ? '✅ Your background check is cleared, so the lister can approve you.'
                        : 'Adopters need a cleared background check — tapping above will start screening (reviewed by our team, which can take a few days; valid 12 months).'}
                    </Text>
                  ) : null}
                </>
              ) : null
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
              <Text variant="heading">
                Adoption requests{interestsQuery.isSuccess ? ` (${interests.length})` : ''}
              </Text>
              <Text variant="small" muted>
                Approval requires the applicant&apos;s background check to be cleared.
              </Text>
              {interestsQuery.isPending ? (
                <Text variant="small" muted>
                  Loading adoption requests…
                </Text>
              ) : interestsQuery.isError ? (
                <QueryFailure
                  message="Could not load adoption requests."
                  loading={interestsQuery.isFetching}
                  onRetry={() => void interestsQuery.refetch()}
                />
              ) : interests.length === 0 ? (
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
                      <ApplicantScreeningBadge userId={i.user_id} />
                    </View>
                    {i.status === 'pending' ? (
                      <View style={styles.applicantActions}>
                        <Button
                          title="Approve"
                          size="sm"
                          loading={approveAdoption.isPending && approveAdoption.variables === i.id}
                          disabled={approveAdoption.isPending || declineAdoption.isPending}
                          onPress={() => onApprove(i.id, i.applicant?.username)}
                        />
                        <Button
                          title="Decline"
                          variant="ghost"
                          size="sm"
                          loading={declineAdoption.isPending && declineAdoption.variables === i.id}
                          disabled={approveAdoption.isPending || declineAdoption.isPending}
                          onPress={() => onDecline(i.id, i.applicant?.username)}
                        />
                      </View>
                    ) : (
                      <Text variant="small" muted>
                        {ADOPTION_REQUEST_META[i.status].label}
                      </Text>
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
            {updatesQuery.isLoading ? (
              <Text variant="small" muted>
                Loading activity…
              </Text>
            ) : null}
            {updatesQuery.isError ? (
              <QueryFailure
                message="Could not refresh activity. Any updates shown may be out of date."
                loading={updatesQuery.isFetching}
                onRetry={() => void updatesQuery.refetch()}
              />
            ) : updatesQuery.isSuccess && updates.length === 0 ? (
              <Text variant="small" muted>
                No updates yet. Add a comment to share useful information.
              </Text>
            ) : null}
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
      <PermissionPrimer
        visible={picker.primer.visible}
        kind={picker.primer.kind}
        onAllow={picker.primer.onAllow}
        onDismiss={picker.primer.onDismiss}
      />
      <Celebration celebration={celebration} onDone={dismissCelebration} />
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
  const actor = update.author?.username;
  const text =
    update.body ??
    (update.new_status
      ? `${actor ? `${actor} marked it as` : 'Marked as'} ${STATUS_META[update.new_status].label}`
      : 'Update');
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

function QueryFailure({
  message,
  loading,
  onRetry,
}: {
  message: string;
  loading: boolean;
  onRetry: () => void;
}) {
  return (
    <View style={styles.caseSummary}>
      <Text variant="small" muted accessibilityRole="alert">
        {message}
      </Text>
      <Button title="Try again" variant="outline" size="sm" loading={loading} onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  unavailable: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  caseSummary: { gap: spacing.sm },
  caseAction: { alignSelf: 'flex-start', marginTop: spacing.xs },
  content: { paddingBottom: spacing.xxxl },
  hero: { width: '100%', height: 280, backgroundColor: colors.primaryTint },
  heroFallback: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  demoLabel: { position: 'absolute', top: spacing.md, right: spacing.md },
  heroEmoji: { fontSize: 96 },
  gallery: { gap: spacing.sm, paddingBottom: spacing.xs },
  galleryThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.primaryTint,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  galleryThumbActive: { borderColor: colors.primary },
  addPhoto: { gap: spacing.xs, alignItems: 'flex-start' },
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
  liveCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryTint,
    borderWidth: 1,
    borderColor: colors.primarySoft,
  },
  liveIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directions: { marginTop: spacing.sm },
  applicantRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  applicantActions: { gap: spacing.xs, alignItems: 'stretch' },
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
