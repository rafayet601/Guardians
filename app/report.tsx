import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { choosePhotoSource, notify, type PhotoSource } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import {
  hasPrimerBeenShown,
  markPrimerShown,
  trackPermissionResult,
  type PermissionKind,
} from '@/lib/permissions';
import { useAiAutofill } from '@/hooks/useAiAutofill';
import { screenPhotoBestEffort } from '@/hooks/useAiModeration';
import { useCreateSighting } from '@/hooks/useSightings';
import { useCurrentLocation } from '@/hooks/useLocation';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, radius, spacing } from '@/theme';
import type { CatTemperament } from '@/types/models';
import { DEFAULT_REGION, regionForRadius } from '@/utils/geo';

const TEMPERAMENTS = Object.keys(TEMPERAMENT_META) as CatTemperament[];
const MAX_PHOTOS = 4;

const kindForSource = (source: PhotoSource): PermissionKind =>
  source === 'camera' ? 'camera' : 'mediaLibrary';

export default function ReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { coords, request } = useCurrentLocation();
  const createSighting = useCreateSighting();
  const autofill = useAiAutofill();

  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [marker, setMarker] = useState<LatLng | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [temperament, setTemperament] = useState<CatTemperament>('unknown');
  const [isInjured, setIsInjured] = useState(false);
  const [needsUrgent, setNeedsUrgent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  // default the marker to the user's location once available
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (coords && !marker) setMarker({ latitude: coords.lat, longitude: coords.lng });
  }, [coords]);

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
      setPhotos((p) => [...p, result.assets[0]]);
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
    if (!mode) return;
    await markPrimerShown(kindForSource(mode));
    if (await requestPhotoPermission(mode)) await launchPicker(mode);
  };

  const dismissPhotoPrimer = async () => {
    const mode = photoPrimerSource;
    setPhotoPrimerSource(null);
    if (!mode) return;
    await markPrimerShown(kindForSource(mode));
    trackPermissionResult(kindForSource(mode), 'dismissed');
  };

  const addPhoto = async () => {
    const source = await choosePhotoSource();
    if (source) pickFrom(source);
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
    if (!marker) {
      notify('Location required', 'Tap the map to mark where you saw the cat.');
      return;
    }
    if (!user) return;
    setSubmitting(true);
    try {
      const photoUrls: string[] = [];
      for (const asset of photos) {
        const url = await uploadCatPhoto(user.id, {
          uri: asset.uri,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
          base64: asset.base64,
        });
        photoUrls.push(url);
      }
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
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      router.back();
    } catch (e) {
      notify('Could not post', getErrorMessage(e, 'Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const region = coords ? regionForRadius(coords.lat, coords.lng, 800) : DEFAULT_REGION;

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      <View style={styles.modalHeader}>
        <Text variant="heading">Report a cat</Text>
        <Pressable
          onPress={() => router.back()}
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
                  disabled={autofill.isPending}
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
            />
            <Input
              label="Description (optional)"
              placeholder="Behavior, where it hides, anything helpful…"
              value={description}
              onChangeText={setDescription}
              multiline
            />
            <Input
              label="Color / markings (optional)"
              placeholder="e.g. black & white"
              value={color}
              onChangeText={setColor}
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
            />
            <ToggleRow label="🚨 Needs urgent help" value={needsUrgent} onChange={setNeedsUrgent} />
          </Animated.View>

          <Animated.View entering={entrance(5)}>
            <Button
              title="Post sighting"
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
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text variant="body">{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
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
