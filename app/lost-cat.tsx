import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { uploadCatPhoto } from '@/api/storage';
import { MapSearchBar } from '@/components/MapSearchBar';
import { PermissionPrimer } from '@/components/PermissionPrimer';
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
import { choosePhotoSource, confirmAsync, notify, type PhotoSource } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import {
  hasPrimerBeenShown,
  markPrimerShown,
  trackPermissionResult,
  type PermissionKind,
} from '@/lib/permissions';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, radius, spacing } from '@/theme';
import { formatDistance, timeAgo } from '@/utils/format';
import { LAST_SEEN_OPTIONS, lastSeenIso, type LastSeenKey } from '@/utils/lostCat';
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

const kindForSource = (source: PhotoSource): PermissionKind =>
  source === 'camera' ? 'camera' : 'mediaLibrary';

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
  const [lastSeen, setLastSeen] = useState<LastSeenKey>('now');
  // Where the cat was last seen when that is not where the owner is standing
  // now, or when location is switched off. Takes priority over the device fix.
  const [place, setPlace] = useState<{ lat: number; lng: number; label: string } | null>(null);
  const [placeQuery, setPlaceQuery] = useState('');
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [locationPrimerVisible, setLocationPrimerVisible] = useState(false);
  const [photoPrimerSource, setPhotoPrimerSource] = useState<PhotoSource | null>(null);

  // Prime once before the OS location prompt (P1-1). Requesting when the
  // permission is already decided is prompt-free, so returning users keep
  // auto-fill and previously-denied users keep the existing denied-state UI.
  useEffect(() => {
    let active = true;
    (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!active) return;
      if (perm.granted || !perm.canAskAgain) {
        void request();
        return;
      }
      const shown = await hasPrimerBeenShown('location');
      if (active && !shown) setLocationPrimerVisible(true);
    })();
    return () => {
      active = false;
    };
  }, [request]);

  const allowLocationPrimer = async () => {
    setLocationPrimerVisible(false);
    await markPrimerShown('location');
    const next = await request();
    trackPermissionResult('location', next ? 'granted' : 'denied');
  };

  const dismissLocationPrimer = async () => {
    setLocationPrimerVisible(false);
    await markPrimerShown('location');
    trackPermissionResult('location', 'dismissed');
  };

  // Explicit "Use my location" tap — the button itself is the user's ask, so
  // the OS request fires directly (the mount primer has already run by then).
  const useMyLocation = async () => {
    const next = await request();
    trackPermissionResult('location', next ? 'granted' : 'denied');
  };

  const searchPlace = async () => {
    const q = placeQuery.trim();
    if (!q || searchingPlace) return;
    setSearchingPlace(true);
    try {
      const results = await Location.geocodeAsync(q);
      if (results[0]) {
        setPlace({ lat: results[0].latitude, lng: results[0].longitude, label: q });
      } else {
        notify('Place not found', 'Try a more specific street or area.');
      }
    } catch {
      notify(
        'Search unavailable',
        'Place search is unavailable right now. You can use your current location instead.',
      );
    } finally {
      setSearchingPlace(false);
    }
  };

  const launchPicker = async (source: PhotoSource) => {
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, base64: true });
    if (!result.canceled && result.assets[0]) setPhoto(result.assets[0]);
  };

  // OS request + outcome tracking. Only called when a real OS decision is
  // pending, so already-granted launches stay out of the funnel.
  const requestPhotoPermission = async (source: PhotoSource): Promise<boolean> => {
    const kind = kindForSource(source);
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    trackPermissionResult(kind, perm.granted ? 'granted' : 'denied');
    if (!perm.granted) {
      notify('Permission needed', `Please allow ${source} access to add a photo.`);
      return false;
    }
    return true;
  };

  const pickPhoto = async () => {
    const source = await choosePhotoSource();
    if (!source) return;
    if (source !== 'camera' && Platform.OS !== 'ios') {
      await launchPicker(source);
      return;
    }
    const kind = kindForSource(source);
    const existing =
      source === 'camera'
        ? await ImagePicker.getCameraPermissionsAsync()
        : await ImagePicker.getMediaLibraryPermissionsAsync();
    if (existing.granted) {
      await launchPicker(source); // already granted — no prompt, no funnel event
      return;
    }
    if (existing.canAskAgain && !(await hasPrimerBeenShown(kind))) {
      setPhotoPrimerSource(source); // prime once; "Continue" resumes the flow
      return;
    }
    if (await requestPhotoPermission(source)) await launchPicker(source);
  };

  const allowPhotoPrimer = async () => {
    const source = photoPrimerSource;
    setPhotoPrimerSource(null);
    if (!source) return;
    await markPrimerShown(kindForSource(source));
    if (await requestPhotoPermission(source)) await launchPicker(source);
  };

  const dismissPhotoPrimer = async () => {
    const source = photoPrimerSource;
    setPhotoPrimerSource(null);
    if (!source) return;
    await markPrimerShown(kindForSource(source));
    trackPermissionResult(kindForSource(source), 'dismissed');
  };

  const submit = async () => {
    if (!photo?.base64) {
      notify('Photo required', 'Please add a photo of your cat so we can match sightings.');
      return;
    }
    if (!user) return;
    const where = place ?? coords;
    if (!where) {
      notify(
        'Where were they last seen?',
        'Search for the street or area, or allow location and tap "Use my location".',
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
      const lastSeenAt = lastSeenIso(lastSeen);
      const foldedDescription = [locationNotes.trim(), description.trim()]
        .filter(Boolean)
        .join(locationNotes.trim() && description.trim() ? ' · ' : '');
      await createLostCat.mutateAsync({
        photoUrl,
        lat: where.lat,
        lng: where.lng,
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
      setLastSeen('now');
      setPlace(null);
      setPlaceQuery('');
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
    <>
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
            {place ? (
              <Pill label={`📍 ${place.label}`} fg={colors.primary} bg={colors.primarySoft} />
            ) : coords ? (
              <Pill label="📍 Using your location" fg={colors.primary} bg={colors.primarySoft} />
            ) : (
              <PressableScale onPress={useMyLocation} style={styles.retryBtn}>
                <Text variant="smallStrong" color={colors.primary}>
                  Use my location
                </Text>
              </PressableScale>
            )}
          </View>
          {status === 'denied' && !place ? (
            <Text variant="small" color={colors.danger}>
              Location is off. Search for the street or area where they were last seen instead.
            </Text>
          ) : null}
          <MapSearchBar
            value={placeQuery}
            onChangeText={setPlaceQuery}
            onSubmit={searchPlace}
            submitting={searchingPlace}
            placeholder="Search for the street or area"
          />
          {place && coords ? (
            <Pressable onPress={() => setPlace(null)} hitSlop={8} style={styles.photoRemoveRow}>
              <Text variant="small" color={colors.primary}>
                Use my current location instead
              </Text>
            </Pressable>
          ) : null}
          <Input
            label="Landmark / cross-street notes (optional)"
            placeholder="e.g. near the corner store on Elm St"
            value={locationNotes}
            onChangeText={setLocationNotes}
          />
        </View>

        {/* Last-seen time */}
        <View style={styles.locationBox}>
          <Text variant="smallStrong" color={colors.textSecondary}>
            When did you last see them?
          </Text>
          <View style={styles.chipRow}>
            {LAST_SEEN_OPTIONS.map((option) => {
              const active = lastSeen === option.key;
              return (
                <PressableScale
                  key={option.key}
                  onPress={() => setLastSeen(option.key)}
                  style={[styles.chip, active && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option.label}
                >
                  <Text variant="smallStrong" color={active ? colors.white : colors.text}>
                    {option.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </View>

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

      {/* One-time permission primers (P1-1) */}
      <PermissionPrimer
        visible={locationPrimerVisible}
        kind="location"
        onAllow={allowLocationPrimer}
        onDismiss={dismissLocationPrimer}
      />
      <PermissionPrimer
        visible={photoPrimerSource !== null}
        kind={photoPrimerSource ? kindForSource(photoPrimerSource) : 'camera'}
        onAllow={allowPhotoPrimer}
        onDismiss={dismissPhotoPrimer}
      />
    </>
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
  const router = useRouter();
  const confirm = useConfirmLostCatMatch(lostCatId);
  const reject = useRejectLostCatMatch(lostCatId);

  // The sighting is where the owner can look at the cat properly and reach the
  // person who found it, so every match has to lead there.
  const openSighting = () => router.push(`/sighting/${match.sighting_id}`);

  const onConfirm = async () => {
    const ok = await confirmAsync({
      title: 'Is this your cat?',
      message:
        "We'll mark this match as confirmed and open the sighting so you can get in touch with the person who reported it.",
      confirmLabel: "Yes, that's my cat",
    });
    if (!ok) return;
    confirm.mutate(match.id, {
      onSuccess: () => {
        notify(
          'Match confirmed 🎉',
          'Leave a comment on the sighting so the reporter knows this is your cat. They will see it the next time they open the report.',
        );
        openSighting();
      },
      onError: (e) => notify('Could not confirm', getErrorMessage(e, 'Please try again.')),
    });
  };

  const onReject = async () => {
    const ok = await confirmAsync({
      title: 'Not them?',
      message: "We'll hide this match and keep watching for new sightings.",
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

  const sightingLabel = match.sightingTitle?.trim() || 'A cat sighting';

  return (
    <View style={styles.matchRow}>
      <PressableScale
        onPress={openSighting}
        accessibilityRole="button"
        accessibilityLabel={`Open sighting: ${sightingLabel}`}
      >
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
      </PressableScale>
      <View style={styles.matchInfo}>
        <PressableScale
          onPress={openSighting}
          accessibilityRole="button"
          accessibilityLabel={`Open sighting: ${sightingLabel}, about ${pct} percent match`}
        >
          <Text variant="bodyStrong" numberOfLines={1}>
            {sightingLabel}
          </Text>
          <Text variant="small" muted>
            ~{pct}% match{distanceLabel} · {when}
          </Text>
        </PressableScale>
        {match.status === 'confirmed' ? (
          <View style={styles.matchActions}>
            <Pill label="✓ Confirmed" fg={colors.primary} bg={colors.primarySoft} />
            <Button title="Open sighting" size="sm" onPress={openSighting} />
          </View>
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
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
