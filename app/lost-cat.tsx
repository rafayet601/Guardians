import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uploadCatPhoto } from '@/api/storage';
import { PressableScale } from '@/components/PressableScale';
import { Button, Card, EmptyState, Input, Loading, Pill, Text } from '@/components/ui';
import { AI_FEATURES } from '@/constants/ai';
import {
  useConfirmLostCatMatch,
  useCreateLostCat,
  useLostCatMatches,
  useMyLostCats,
  useRejectLostCatMatch,
} from '@/hooks/useLostCat';
import { useCurrentLocation } from '@/hooks/useLocation';
import { choosePhotoSource, confirmAsync, notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, radius, spacing } from '@/theme';
import { formatDistance, timeAgo } from '@/utils/format';
import type { LostCat, LostCatMatch, LostCatStatus } from '@/types/ai';

const STATUS_META: Record<LostCatStatus, { label: string; icon: string; fg: string; bg: string }> =
  {
    open: { label: 'Open', icon: '🔍', fg: colors.primary, bg: colors.primarySoft },
    matched: { label: 'Matched', icon: '🎯', fg: colors.accentDark, bg: colors.accentSoft },
    closed: { label: 'Home', icon: '🏠', fg: colors.textSecondary, bg: colors.divider },
  };

export default function LostCatScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (!AI_FEATURES.lostCatReunion) {
    return (
      <ScrollView
        style={[styles.flex, { paddingTop: insets.top }]}
        contentContainerStyle={styles.gatedContent}
      >
        <Header onBack={() => router.back()} />
        <EmptyState
          icon="🐾"
          title="Lost-cat reunification isn't available"
          message="This feature is turned off right now. You can still report sightings of any cat you see."
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={[styles.flex, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Header onBack={() => router.back()} />
      <LostCatForm />
      <MyLostCats />
    </ScrollView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.modalHeader}>
      <Pressable onPress={onBack} hitSlop={10}>
        <Ionicons name="chevron-back" size={26} color={colors.primary} />
      </Pressable>
      <Text variant="heading">Lost a cat?</Text>
      <View style={{ width: 26 }} />
    </View>
  );
}

// ── "I lost my cat" form ───────────────────────────────────────────────────

function LostCatForm() {
  const { user } = useAuth();
  const { coords, status, request } = useCurrentLocation();
  const createLostCat = useCreateLostCat();
  const reduced = useReducedMotion() ?? false;
  const entrance = (i: number) => {
    if (reduced) return FadeInDown.duration(0);
    return FadeInDown.delay(i * motion.stagger)
      .duration(motion.enter)
      .springify()
      .damping(motion.damping);
  };

  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [title, setTitle] = useState('');
  const [locationNotes, setLocationNotes] = useState('');
  const [description, setDescription] = useState('');
  const [lastSeenAtText, setLastSeenAtText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pickPhoto = async () => {
    const source = await choosePhotoSource();
    if (!source) return;
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      notify('Permission needed', `Please allow ${source} access to add a photo.`);
      return;
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true, base64: true })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.6,
            allowsEditing: true,
            base64: true,
          });
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0]);
  };

  const submit = async () => {
    if (!photo?.base64) {
      notify('Photo required', 'Please add a photo of your cat so we can match sightings.');
      return;
    }
    if (!user) return;
    if (!coords) {
      notify(
        'Location needed',
        'Allow location access so we know where to search. Tap "Use my location" to retry.',
      );
      return;
    }
    // Validate the free-text "last seen" up front rather than silently
    // defaulting an unparseable value to now — a wrong last-seen time misleads
    // the owner and skews match prioritization.
    const trimmedLastSeen = lastSeenAtText.trim();
    if (trimmedLastSeen && Number.isNaN(new Date(trimmedLastSeen).getTime())) {
      notify(
        'Check the date',
        'We couldn\'t read that "last seen" time. Use a format like 2024-03-15 18:00, or leave it blank for "just now".',
      );
      return;
    }
    setSubmitting(true);
    try {
      const photoUrl = await uploadCatPhoto(user.id, {
        uri: photo.uri,
        mimeType: photo.mimeType,
        fileName: photo.fileName,
        base64: photo.base64,
      });
      const parsed = lastSeenAtText.trim() ? new Date(lastSeenAtText) : new Date();
      const lastSeenAt = Number.isNaN(parsed.getTime())
        ? new Date().toISOString()
        : parsed.toISOString();
      const foldedDescription = [locationNotes.trim(), description.trim()]
        .filter(Boolean)
        .join(locationNotes.trim() && description.trim() ? ' · ' : '');
      await createLostCat.mutateAsync({
        photoUrl,
        lat: coords.lat,
        lng: coords.lng,
        lastSeenAt,
        title: title.trim() || undefined,
        description: foldedDescription || undefined,
      });
      notify(
        'Posted 🐾',
        "We'll watch every new sighting for a match and notify you the moment one looks like your cat.",
      );
      setPhoto(null);
      setTitle('');
      setLocationNotes('');
      setDescription('');
      setLastSeenAtText('');
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
    } catch (e) {
      notify('Could not post', getErrorMessage(e, 'Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Animated.View entering={entrance(0)} style={styles.section}>
      <Text variant="subheading">Tell us about your cat</Text>
      <Text variant="small" muted>
        Every cat deserves to get home. Tell us about your cat and we&apos;ll watch every new
        sighting for a match.
      </Text>

      {/* Photo picker */}
      <PressableScale onPress={pickPhoto} style={styles.photoPicker} scaleTo={0.98}>
        {photo ? (
          <Image source={{ uri: photo.uri }} style={styles.photoPreview} contentFit="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="camera" size={28} color={colors.primary} />
            <Text variant="smallStrong" color={colors.primary}>
              Add a photo of your cat
            </Text>
            <Text variant="caption" muted>
              We use it to match against new sightings
            </Text>
          </View>
        )}
      </PressableScale>
      {photo ? (
        <Pressable onPress={() => setPhoto(null)} hitSlop={8} style={styles.photoRemoveRow}>
          <Text variant="small" color={colors.danger}>
            Remove photo
          </Text>
        </Pressable>
      ) : null}

      {/* Last-seen location */}
      <View style={styles.locationBox}>
        <View style={styles.locationHead}>
          <Text variant="smallStrong" color={colors.textSecondary}>
            Last seen near
          </Text>
          {coords ? (
            <Pill label="📍 Using your location" fg={colors.primary} bg={colors.primarySoft} />
          ) : (
            <PressableScale onPress={() => request()} style={styles.retryBtn}>
              <Text variant="smallStrong" color={colors.primary}>
                Use my location
              </Text>
            </PressableScale>
          )}
        </View>
        {status === 'denied' ? (
          <Text variant="small" color={colors.danger}>
            Location permission denied — we need it to know where to search.
          </Text>
        ) : null}
        <Input
          label="Landmark / cross-street notes (optional)"
          placeholder="e.g. near the corner store on Elm St"
          value={locationNotes}
          onChangeText={setLocationNotes}
        />
      </View>

      {/* Last-seen time */}
      <Input
        label="When did you last see them? (optional)"
        placeholder="e.g. 2024-03-15 18:00 — defaults to now"
        value={lastSeenAtText}
        onChangeText={setLastSeenAtText}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* Title + description */}
      <Input
        label="Cat's name or nickname (optional)"
        placeholder="e.g. Miso"
        value={title}
        onChangeText={setTitle}
      />
      <Input
        label="Description (optional)"
        placeholder="Color, markings, collar, temperament — anything that helps us recognize them"
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <Button
        title="Post and start watching"
        size="lg"
        fullWidth
        loading={submitting}
        onPress={submit}
        style={styles.submit}
      />
    </Animated.View>
  );
}

// ── My lost-cat posts + their matches ──────────────────────────────────────

function MyLostCats() {
  const { data: posts, isLoading } = useMyLostCats();
  const reduced = useReducedMotion() ?? false;
  const entrance = (i: number) => {
    if (reduced) return FadeInDown.duration(0);
    return FadeInDown.delay(i * motion.stagger)
      .duration(motion.enter)
      .springify()
      .damping(motion.damping);
  };

  return (
    <Animated.View entering={entrance(2)} style={styles.section}>
      <Text variant="heading">My lost-cat posts</Text>
      {isLoading ? (
        <Loading label="Loading your posts…" />
      ) : !posts || posts.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Text variant="bodyStrong">No posts yet</Text>
          <Text variant="small" muted>
            Post above and we&apos;ll watch every new sighting for a match.
          </Text>
        </Card>
      ) : (
        <View style={styles.postsList}>
          {posts.map((post, i) => (
            <Animated.View
              key={post.id}
              entering={FadeInDown.delay(Math.min(i, 4) * motion.stagger)
                .duration(motion.enter)
                .springify()
                .damping(motion.damping)}
            >
              <LostCatPostCard post={post} />
            </Animated.View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

function LostCatPostCard({ post }: { post: LostCat }) {
  const { data: matches, isLoading } = useLostCatMatches(post.id);
  const meta = STATUS_META[post.status] ?? STATUS_META.open;

  return (
    <Card style={styles.postCard}>
      <View style={styles.postHead}>
        {post.photoUrl ? (
          <Image source={{ uri: post.photoUrl }} style={styles.postPhoto} contentFit="cover" />
        ) : (
          <View style={[styles.postPhoto, styles.thumbFallback]}>
            <Text variant="body">🐱</Text>
          </View>
        )}
        <View style={styles.postInfo}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {post.title?.trim() || 'My lost cat'}
          </Text>
          <Text variant="small" muted>
            Last seen {post.lastSeenAt ? timeAgo(post.lastSeenAt) : 'unknown'}
          </Text>
          <Pill
            label={`${meta.icon} ${meta.label}`}
            fg={meta.fg}
            bg={meta.bg}
            style={styles.postPill}
          />
        </View>
      </View>

      {post.description ? (
        <Text variant="small" muted style={styles.postDesc}>
          {post.description}
        </Text>
      ) : null}

      <View style={styles.matchesSection}>
        <Text variant="smallStrong" color={colors.textSecondary}>
          Possible matches
        </Text>
        {isLoading ? (
          <Text variant="small" muted>
            Checking sightings…
          </Text>
        ) : !matches || matches.length === 0 ? (
          <Text variant="small" muted>
            No matches yet — we&apos;ll notify you the moment a sighting looks like your cat.
          </Text>
        ) : (
          <View style={styles.matchesList}>
            {matches.map((m) => (
              <LostCatMatchRow key={m.id} match={m} lostCatId={post.id} />
            ))}
          </View>
        )}
      </View>
    </Card>
  );
}

function LostCatMatchRow({ match, lostCatId }: { match: LostCatMatch; lostCatId: string }) {
  const confirm = useConfirmLostCatMatch(lostCatId);
  const reject = useRejectLostCatMatch(lostCatId);

  const onConfirm = async () => {
    const ok = await confirmAsync({
      title: 'Is this your cat?',
      message:
        "We'll mark this match as confirmed and route you to the sighting. You can undo this later.",
      confirmLabel: "Yes, that's my cat",
    });
    if (!ok) return;
    confirm.mutate(match.id, {
      onSuccess: () => notify('Match confirmed 🎉', "We'll help you connect with the reporter."),
      onError: (e) => notify('Could not confirm', getErrorMessage(e, 'Please try again.')),
    });
  };

  const onReject = async () => {
    const ok = await confirmAsync({
      title: 'Not them?',
      message: "We'll hide this match. You can undo this later if things change.",
      confirmLabel: 'Not them',
      destructive: true,
    });
    if (!ok) return;
    reject.mutate(match.id, {
      onError: (e) => notify('Could not reject', getErrorMessage(e, 'Please try again.')),
    });
  };

  const pct = Math.round((match.confidence ?? 0) * 100);
  const distanceLabel =
    typeof match.distanceM === 'number' && match.distanceM > 0
      ? ` · ${formatDistance(match.distanceM)}`
      : '';
  const when = match.sightingCreatedAt
    ? timeAgo(match.sightingCreatedAt)
    : match.createdAt
      ? timeAgo(match.createdAt)
      : '';

  return (
    <View style={styles.matchRow}>
      {match.sightingThumbnailUrl ? (
        <Image
          source={{ uri: match.sightingThumbnailUrl }}
          style={styles.matchThumb}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.matchThumb, styles.thumbFallback]}>
          <Text variant="body">🐱</Text>
        </View>
      )}
      <View style={styles.matchInfo}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {match.sightingTitle?.trim() || 'A cat sighting'}
        </Text>
        <Text variant="small" muted>
          ~{pct}% match{distanceLabel} · {when}
        </Text>
        {match.status === 'confirmed' ? (
          <Pill
            label="✓ Confirmed"
            fg={colors.primary}
            bg={colors.primarySoft}
            style={styles.matchPill}
          />
        ) : match.status === 'rejected' ? (
          <Pill
            label="Not them"
            fg={colors.textMuted}
            bg={colors.divider}
            style={styles.matchPill}
          />
        ) : (
          <View style={styles.matchActions}>
            <Button
              title="Yes, that's my cat"
              size="sm"
              loading={confirm.isPending}
              onPress={onConfirm}
              style={styles.matchBtn}
            />
            <Button
              title="Not them"
              size="sm"
              variant="outline"
              loading={reject.isPending}
              onPress={onReject}
              style={styles.matchBtn}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  gatedContent: { paddingBottom: spacing.xxxl },
  content: { paddingBottom: spacing.xxxl },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  section: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  photoPicker: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  photoPreview: { width: '100%', height: 200 },
  photoPlaceholder: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primaryTint,
    borderWidth: 1.5,
    borderColor: colors.primaryLight,
    borderStyle: 'dashed',
    borderRadius: radius.lg,
  },
  photoRemoveRow: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  locationBox: { gap: spacing.sm },
  locationHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  retryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTint,
  },
  submit: { marginTop: spacing.sm },
  emptyCard: { gap: spacing.xs },
  postsList: { gap: spacing.md },
  postCard: { gap: spacing.md },
  postHead: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  postPhoto: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.divider,
  },
  postInfo: { flex: 1, gap: 4 },
  postPill: { alignSelf: 'flex-start', marginTop: 2 },
  postDesc: { marginLeft: 2 },
  matchesSection: { gap: spacing.xs, marginTop: spacing.xs },
  matchesList: { gap: spacing.md, marginTop: spacing.xs },
  matchRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  matchThumb: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.divider,
  },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  matchInfo: { flex: 1, gap: 4 },
  matchPill: { alignSelf: 'flex-start', marginTop: 2 },
  matchActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  matchBtn: { flex: 1 },
});
