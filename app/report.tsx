import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapView, Marker, MAP_PROVIDER, type LatLng } from '@/components/PlatformMap';
import { PermissionPrimer } from '@/components/PermissionPrimer';
import { PressableScale } from '@/components/PressableScale';
import { uploadCatPhoto } from '@/api/storage';
import { Button, Input, Text } from '@/components/ui';
import { AI_FEATURES } from '@/constants/ai';
import { TEMPERAMENT_META } from '@/constants/status';
import { choosePhotoSource, confirmAsync, notify, type PhotoSource } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import {
  hasPrimerBeenShown,
  markPrimerShown,
  trackPermissionResult,
  type PermissionKind,
} from '@/lib/permissions';
import { useAiAutofill } from '@/hooks/useAiAutofill';
import { screenPhotoBestEffort } from '@/hooks/useAiModeration';
import { matchSightingAgainstLostCatsBestEffort } from '@/hooks/useLostCat';
import { useCreateSighting } from '@/hooks/useSightings';
import { useCurrentLocation } from '@/hooks/useLocation';
import { useReportDraft } from '@/hooks/useReportDraft';
import { hasReportDraft } from '@/lib/reportDraft';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, radius, spacing } from '@/theme';
import type { CatTemperament } from '@/types/models';
import { DEFAULT_REGION, regionForRadius } from '@/utils/geo';

const TEMPERAMENTS = Object.keys(TEMPERAMENT_META) as CatTemperament[];
const MAX_PHOTOS = 4;

const kindForSource = (source: PhotoSource): PermissionKind =>
  source === 'camera' ? 'camera' : 'mediaLibrary';

export default function ReportScreen() {
  const { user } = useAuth();
  return <ReportForm key={user?.id ?? 'signed-out'} />;
}

function ReportForm() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { coords, request } = useCurrentLocation();
  const createSighting = useCreateSighting();
  const autofill = useAiAutofill();

  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const {
    draft,
    setDraft,
    ready,
    restored,
    saveStatus,
    clear: clearDraft,
  } = useReportDraft(user?.id);
  const { marker, title, description, color, temperament, isInjured, needsUrgent } = draft;
  const setMarker = (value: LatLng | null) => setDraft((d) => ({ ...d, marker: value }));
  const setTitle = (value: string) => setDraft((d) => ({ ...d, title: value }));
  const setDescription = (value: string) => setDraft((d) => ({ ...d, description: value }));
  const setColor = (value: string) => setDraft((d) => ({ ...d, color: value }));
  const setTemperament = (value: CatTemperament) => setDraft((d) => ({ ...d, temperament: value }));
  const setIsInjured = (value: boolean) => setDraft((d) => ({ ...d, isInjured: value }));
  const setNeedsUrgent = (value: boolean) => setDraft((d) => ({ ...d, needsUrgent: value }));
  const [submitting, setSubmitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [picking, setPicking] = useState(false);
  const pickerLock = useRef(false);
  const [submissionStep, setSubmissionStep] = useState('');
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const uploadedPhotos = useRef(new Map<string, string>());
  const busy = submitting || discarding || picking || autofill.isPending || !ready;
  // True once an autofill suggestion has prefilled the form, so we can subtly
  // label the fields as AI-suggested-but-editable until the user posts.
  const [autofilled, setAutofilled] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const entrance = (i: number) => {
    if (reduced) return FadeInDown.duration(0);
    return FadeInDown.delay(i * motion.stagger)
      .duration(motion.enter)
      .springify()
      .damping(motion.damping);
  };
  const [locationPrimerVisible, setLocationPrimerVisible] = useState(false);
  const [photoPrimerSource, setPhotoPrimerSource] = useState<PhotoSource | null>(null);

  // default the marker to the user's location once available (intentionally
  // only when `coords` changes — a pin the user cleared must not snap back)
  useEffect(() => {
    if (ready && coords && !marker) setMarker({ latitude: coords.lat, longitude: coords.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, ready]);

  // Prime once before the OS location prompt (P1-1). Requesting when the
  // permission is already decided is prompt-free, so returning users keep
  // the location default and previously-denied users just keep the manual pin.
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
    })().catch(() => {
      // Location lookup is optional: manual map placement remains available.
    });
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

  const launchPicker = async (mode: PhotoSource) => {
    const result =
      mode === 'camera'
        ? await ImagePicker.launchCameraAsync({
            quality: 0.6,
            allowsEditing: true,
            base64: true,
          })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.6,
            allowsEditing: true,
            base64: true,
          });
    if (!result.canceled && result.assets[0]) {
      setPhotos((p) => [...p, result.assets[0]].slice(0, MAX_PHOTOS));
    }
  };

  // OS request + outcome tracking. Only called when a real OS decision is
  // pending, so already-granted launches stay out of the funnel.
  const requestPhotoPermission = async (mode: PhotoSource): Promise<boolean> => {
    const kind = kindForSource(mode);
    const perm =
      mode === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    trackPermissionResult(kind, perm.granted ? 'granted' : 'denied');
    if (!perm.granted) {
      notify('Permission needed', `Please allow ${mode} access to add a photo.`);
      return false;
    }
    return true;
  };

  const pickFrom = async (mode: PhotoSource) => {
    if (photos.length >= MAX_PHOTOS) return;
    const kind = kindForSource(mode);
    const existing =
      mode === 'camera'
        ? await ImagePicker.getCameraPermissionsAsync()
        : await ImagePicker.getMediaLibraryPermissionsAsync();
    if (existing.granted) {
      await launchPicker(mode); // already granted — no prompt, no funnel event
      return;
    }
    if (existing.canAskAgain && !(await hasPrimerBeenShown(kind))) {
      setPhotoPrimerSource(mode); // prime once; "Continue" resumes the flow
      return;
    }
    if (await requestPhotoPermission(mode)) await launchPicker(mode);
  };

  const allowPhotoPrimer = async () => {
    const mode = photoPrimerSource;
    setPhotoPrimerSource(null);
    if (!mode || pickerLock.current) return;
    pickerLock.current = true;
    setPicking(true);
    try {
      await markPrimerShown(kindForSource(mode));
      if (await requestPhotoPermission(mode)) await launchPicker(mode);
    } catch (error) {
      notify('Could not add photo', getErrorMessage(error, 'Please try choosing the photo again.'));
    } finally {
      pickerLock.current = false;
      setPicking(false);
    }
  };

  const dismissPhotoPrimer = async () => {
    const mode = photoPrimerSource;
    setPhotoPrimerSource(null);
    if (!mode) return;
    await markPrimerShown(kindForSource(mode));
    trackPermissionResult(kindForSource(mode), 'dismissed');
  };

  const addPhoto = async () => {
    if (busy || pickerLock.current) return;
    pickerLock.current = true;
    setPicking(true);
    try {
      const source = await choosePhotoSource();
      if (source) await pickFrom(source);
    } catch (error) {
      notify('Could not add photo', getErrorMessage(error, 'Please try choosing the photo again.'));
    } finally {
      pickerLock.current = false;
      setPicking(false);
    }
  };

  // ✨ AI autofill: send the first attached photo to the vision model and use
  // its result to PREFILL the editable form fields. The user still reviews and
  // posts — the suggestion is never wired straight into createSighting.
  const runAutofill = async () => {
    const photo = photos[0];
    if (!photo?.base64) {
      notify('No photo data', 'Please attach a photo before using autofill.');
      return;
    }
    try {
      const s = await autofill.mutateAsync({
        imageBase64: photo.base64,
        mediaType: photo.mimeType ?? 'image/jpeg',
      });
      // Fold distinguishing marks into the "color / markings" field.
      const colorMarks = [s.color, s.marks]
        .map((v) => v.trim())
        .filter(Boolean)
        .join(' · ');
      if (s.title) setTitle(s.title);
      if (s.description) setDescription(s.description);
      if (colorMarks) setColor(colorMarks);
      setTemperament(s.temperament);
      setIsInjured(s.isInjured);
      setAutofilled(true);
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }
    } catch (e) {
      notify('Autofill unavailable', getErrorMessage(e, 'Please fill the form in manually.'));
    }
  };

  const submit = async () => {
    if (submitLock.current || pickerLock.current || busy) return;
    if (!marker) {
      notify('Location required', 'Tap the map to mark where you saw the cat.');
      return;
    }
    if (!user) return;
    submitLock.current = true;
    setSubmitting(true);
    setSubmissionError(null);
    try {
      const photoUrls: string[] = [];
      for (const [index, asset] of photos.entries()) {
        setSubmissionStep(`Uploading photo ${index + 1} of ${photos.length}…`);
        const url =
          uploadedPhotos.current.get(asset.uri) ??
          (await uploadCatPhoto(user.id, {
            uri: asset.uri,
            mimeType: asset.mimeType,
            fileName: asset.fileName,
            base64: asset.base64,
          }));
        uploadedPhotos.current.set(asset.uri, url);
        photoUrls.push(url);
      }
      setSubmissionStep('Posting your sighting…');
      const sighting = await createSighting.mutateAsync({
        lat: marker.latitude,
        lng: marker.longitude,
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        color: color.trim() || undefined,
        temperament,
        isInjured,
        needsUrgentHelp: needsUrgent,
        photoUrls,
      });
      // 🛡️ Background photo screening (AI-M2 #9). Fire-and-forget by contract:
      // the helper no-ops when its flag is off and swallows its own errors, so
      // this can never block, delay, or fail the report. Runs only once the
      // sighting exists and its photos are uploaded (the server checks the
      // caller is the sighting's reporter).
      for (const asset of photos) {
        if (!asset.base64) continue;
        void screenPhotoBestEffort({
          imageBase64: asset.base64,
          mediaType: asset.mimeType,
          sightingId: sighting.id,
        });
      }
      // 🐾 Lost-cat continuous matching (AI-M4 #5): match this new sighting
      // against open lost-cat posts. Same fire-and-forget contract as above —
      // flag-gated, error-swallowing, never blocks the report. Skipped without
      // a photo, since matching is photo-embedding based.
      if (photoUrls.length > 0) {
        void matchSightingAgainstLostCatsBestEffort(sighting.id);
      }
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      // A local cleanup error must never turn a successful post into a retry.
      await clearDraft(true).catch(() => {
        notify(
          'Sighting posted',
          'Your saved draft could not be removed from this device. Discard it before starting another report.',
        );
      });
      router.replace(`/sighting/${sighting.id}`);
    } catch (e) {
      setSubmissionError(getErrorMessage(e, 'Please try again. Your report is still here.'));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
      setSubmissionStep('');
    }
  };

  const discard = async () => {
    if (busy || submitLock.current) return;
    const confirmed = await confirmAsync({
      title: 'Discard this report?',
      message: 'This removes your saved details and the photos attached to this report.',
      confirmLabel: 'Discard',
      destructive: true,
    });
    if (!confirmed || submitLock.current) return;
    setDiscarding(true);
    try {
      await clearDraft();
      setPhotos([]);
      uploadedPhotos.current.clear();
      setAutofilled(false);
      setSubmissionError(null);
    } catch {
      notify('Could not discard', 'Your report is still here. Please try again.');
    } finally {
      setDiscarding(false);
    }
  };

  const region = marker
    ? regionForRadius(marker.latitude, marker.longitude, 800)
    : coords
      ? regionForRadius(coords.lat, coords.lng, 800)
      : DEFAULT_REGION;

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.modalHeader}>
        <Text variant="heading">Report a cat</Text>
        <Pressable
          onPress={() => router.back()}
          disabled={submitting || discarding || picking}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={26} color={colors.textSecondary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.draftNotice} accessibilityLiveRegion="polite">
            <Text variant="smallStrong">
              {!ready
                ? 'Opening your draft…'
                : saveStatus === 'error'
                  ? 'Draft could not be saved on this device'
                  : saveStatus === 'saving'
                    ? 'Saving draft…'
                    : restored
                      ? 'Saved report restored'
                      : saveStatus === 'saved'
                        ? 'Draft saved on this device'
                        : 'Your report details save on this device'}
            </Text>
            <Text variant="small" muted>
              {saveStatus === 'error' ? 'Keep this screen open to avoid losing your work. ' : ''}
              Photos are kept only while this screen stays open. Add them again if you return later.
              {restored ? ' Review the saved location and details before posting.' : ''}
            </Text>
            {(hasReportDraft(draft) || photos.length > 0 || saveStatus === 'error') && ready ? (
              <Button
                title="Discard draft"
                variant="ghost"
                size="sm"
                onPress={discard}
                disabled={busy}
              />
            ) : null}
          </View>
          <View pointerEvents={busy ? 'none' : 'auto'} style={styles.formSections}>
            {/* Photos */}
            <Animated.View entering={entrance(0)} style={styles.section}>
              <Text variant="subheading">Photos</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoRow}
              >
                {photos.map((p, i) => (
                  <View key={p.uri} style={styles.photoWrap}>
                    <Image source={{ uri: p.uri }} style={styles.photo} contentFit="cover" />
                    <Pressable
                      style={styles.photoRemove}
                      disabled={busy}
                      onPress={() => setPhotos((arr) => arr.filter((_, idx) => idx !== i))}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel="Remove photo"
                    >
                      <Ionicons name="close-circle" size={22} color={colors.white} />
                    </Pressable>
                  </View>
                ))}
                {photos.length < MAX_PHOTOS ? (
                  <Pressable
                    style={styles.addPhoto}
                    disabled={busy}
                    onPress={addPhoto}
                    accessibilityRole="button"
                    accessibilityLabel="Add photo"
                  >
                    <Ionicons name="camera" size={26} color={colors.primary} />
                    <Text variant="caption" color={colors.primary}>
                      ADD
                    </Text>
                  </Pressable>
                ) : null}
              </ScrollView>

              {AI_FEATURES.reportAutofill && photos.length > 0 ? (
                <View style={styles.autofillWrap}>
                  <PressableScale
                    onPress={runAutofill}
                    disabled={busy}
                    style={styles.autofillBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Autofill from photo"
                  >
                    <Ionicons name="sparkles" size={16} color={colors.primary} />
                    <Text variant="smallStrong" color={colors.primary}>
                      {autofill.isPending ? 'Reading the photo…' : 'Autofill from photo'}
                    </Text>
                  </PressableScale>
                  {autofilled ? (
                    <Text variant="small" muted style={styles.autofillHint}>
                      AI suggested these details — please review and edit before posting.
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </Animated.View>

            {/* Location */}
            <Animated.View entering={entrance(1)} style={styles.section}>
              <Text variant="subheading">Where did you see it?</Text>
              <Text variant="small" muted>
                Tap or drag the pin to mark the exact spot.
              </Text>
              <View style={styles.mapWrap}>
                <MapView
                  key={ready ? 'ready' : 'loading'}
                  provider={MAP_PROVIDER}
                  style={styles.map}
                  initialRegion={region}
                  // onPanDrag makes the map win the responder over the parent
                  // ScrollView so taps/drags to place the pin register reliably.
                  onPanDrag={() => {}}
                  onPress={(e) => setMarker(e.nativeEvent.coordinate)}
                >
                  {marker ? (
                    <Marker
                      coordinate={marker}
                      draggable
                      onDragEnd={(e) => setMarker(e.nativeEvent.coordinate)}
                    />
                  ) : null}
                </MapView>
              </View>
            </Animated.View>

            {/* Details */}
            <Animated.View entering={entrance(2)} style={styles.section}>
              <Input
                label="Nickname (optional)"
                placeholder="e.g. Orange tabby by the park"
                value={title}
                onChangeText={setTitle}
                editable={!busy}
              />
              <Input
                label="Description (optional)"
                placeholder="Behavior, where it hides, anything helpful…"
                value={description}
                onChangeText={setDescription}
                editable={!busy}
                multiline
              />
              <Input
                label="Color / markings (optional)"
                placeholder="e.g. black & white"
                value={color}
                onChangeText={setColor}
                editable={!busy}
              />
            </Animated.View>

            {/* Temperament */}
            <Animated.View entering={entrance(3)} style={styles.section}>
              <Text variant="smallStrong" color={colors.textSecondary} style={styles.label}>
                Temperament
              </Text>
              <View style={styles.tempRow}>
                {TEMPERAMENTS.map((t) => {
                  const active = temperament === t;
                  const meta = TEMPERAMENT_META[t];
                  return (
                    <PressableScale
                      key={t}
                      disabled={busy}
                      onPress={() => setTemperament(t)}
                      style={[styles.tempChip, active && styles.tempChipActive]}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={meta.label}
                    >
                      <Text variant="smallStrong" color={active ? colors.white : colors.text}>
                        {meta.icon} {meta.label}
                      </Text>
                    </PressableScale>
                  );
                })}
              </View>
            </Animated.View>

            {/* Flags */}
            <Animated.View entering={entrance(4)} style={styles.section}>
              <ToggleRow
                label="🩹 This cat looks injured"
                value={isInjured}
                onChange={setIsInjured}
                disabled={busy}
              />
              <ToggleRow
                label="🚨 Needs urgent help"
                value={needsUrgent}
                onChange={setNeedsUrgent}
                disabled={busy}
              />
            </Animated.View>
          </View>
          <Animated.View entering={entrance(5)}>
            {submissionError ? (
              <Text variant="small" color={colors.danger} accessibilityRole="alert">
                Could not post: {submissionError} Your report is still here. Check My reports if you
                lost connection before trying again.
              </Text>
            ) : null}
            {submissionStep ? (
              <Text variant="smallStrong" accessibilityLiveRegion="polite">
                {submissionStep}
              </Text>
            ) : null}
            <Button
              title={submissionError ? 'Try posting again' : 'Post sighting'}
              disabled={busy || !user}
              size="lg"
              fullWidth
              loading={submitting}
              onPress={submit}
              style={styles.submit}
            />
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

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
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text variant="body">{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.primaryLight, false: colors.border }}
        thumbColor={colors.white}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
  section: { gap: spacing.md },
  formSections: { gap: spacing.md },
  draftNotice: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  photoRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  autofillWrap: { gap: spacing.xs },
  autofillBtn: {
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
  autofillHint: { marginLeft: 2 },
  photoWrap: { position: 'relative' },
  photo: { width: 96, height: 96, borderRadius: radius.md },
  photoRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
  },
  addPhoto: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
  },
  mapWrap: {
    height: 200,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: { flex: 1 },
  label: { marginTop: spacing.xs, marginLeft: 2 },
  tempRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tempChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tempChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  submit: { marginTop: spacing.lg },
});
