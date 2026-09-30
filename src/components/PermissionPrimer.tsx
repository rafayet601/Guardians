import { Modal, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { Button, Card, Text } from '@/components/ui';
import type { PermissionKind } from '@/lib/permissions';
import type { PushPromptReason } from '@/lib/pushPrompt';
import { colors, spacing } from '@/theme';

const COPY: Record<PermissionKind, { icon: string; title: string; body: string }> = {
  location: {
    icon: '📍',
    title: 'Find cats near you',
    body: 'Guardians uses your location to centre the map on your neighbourhood and show the cats closest to you. You can keep browsing the map without it.',
  },
  camera: {
    icon: '📷',
    title: 'Snap the cat you spotted',
    body: 'A quick photo helps guardians recognize the cat and match lost pets with sightings. Nothing is shared until you post it.',
  },
  mediaLibrary: {
    icon: '🖼️',
    title: 'Add a photo of the cat',
    body: 'Pick a photo from your library so guardians and adopters can recognize the cat. Only the photos you choose are ever shared.',
  },
  notifications: {
    icon: '🔔',
    title: 'Urgent rescue alerts',
    body: 'Get a notification when a cat near you needs urgent help — or when a sighting looks like your lost cat. You can turn alerts off anytime.',
  },
};

/**
 * The notifications ask is now made at a moment that explains itself, so the
 * words should say why now. Only promise what is really sent: urgent alerts for
 * cats nearby, and the claim / rescued / adoption-interest updates.
 */
const NOTIFICATION_COPY: Record<PushPromptReason, { title: string; body: string }> = {
  location: {
    title: 'Get alerts for cats near you',
    body: 'Now that we know your neighbourhood, get a notification when a cat within a few kilometres needs urgent help. You can turn alerts off anytime.',
  },
  report: {
    title: 'Know when help arrives',
    body: "We'll notify you when a Guardian claims your report and when the cat is safe. You can turn alerts off anytime.",
  },
  claim: {
    title: 'Stay ready for the next cat',
    body: "Get a notification when another cat near you needs urgent help, or when someone wants to adopt a cat you've rescued. You can turn alerts off anytime.",
  },
};

const A11Y_KIND: Record<PermissionKind, string> = {
  location: 'location',
  camera: 'camera',
  mediaLibrary: 'photo library',
  notifications: 'notifications',
};

export interface PermissionPrimerProps {
  /** Controls visibility — the primer renders only while true. */
  visible: boolean;
  /** Which OS permission this primer precedes (drives the icon + copy). */
  kind: PermissionKind;
  /** "Continue" — caller marks the primer shown, then runs the OS request. */
  onAllow: () => void;
  /** "Not now" — caller marks the primer shown and tracks 'dismissed'. */
  onDismiss: () => void;
  /** Why the notifications ask is being made now; picks moment-specific copy. */
  reason?: PushPromptReason;
}

/**
 * One-time, value-explaining primer shown immediately before an OS permission
 * prompt (P1-1). Themed modal built from the ui primitives; honors reduced
 * motion by skipping the fade entirely.
 */
export function PermissionPrimer({
  visible,
  kind,
  onAllow,
  onDismiss,
  reason,
}: PermissionPrimerProps) {
  const reduced = useReducedMotion() ?? false;
  const copy =
    kind === 'notifications' && reason
      ? { ...COPY.notifications, ...NOTIFICATION_COPY[reason] }
      : COPY[kind];

  const content = (
    <View style={styles.overlay}>
      <Card style={styles.card}>
        <Text style={styles.icon}>{copy.icon}</Text>
        <Text variant="heading" center>
          {copy.title}
        </Text>
        <Text variant="body" muted center style={styles.body}>
          {copy.body}
        </Text>
        <Button
          title="Continue"
          fullWidth
          onPress={onAllow}
          accessibilityRole="button"
          accessibilityLabel={`Continue and allow ${A11Y_KIND[kind]} access`}
          style={styles.allow}
        />
        <Button
          title="Not now"
          variant="ghost"
          fullWidth
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={`Not now, skip ${A11Y_KIND[kind]} access`}
        />
      </Card>
    </View>
  );

  if (Platform.OS === 'web') {
    // RN's Modal isn't implemented on react-native-web — a fixed overlay gives
    // the web dev preview the same one-time primer.
    return visible ? content : null;
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduced ? 'none' : 'fade'}
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      {content}
    </Modal>
  );
}

const webFixedOverlay = Platform.select<ViewStyle>({
  web: { position: 'fixed' } as unknown as ViewStyle,
  default: {},
});

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    ...webFixedOverlay,
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
    padding: spacing.xl,
  },
  card: { width: '100%', maxWidth: 340, alignItems: 'center' },
  icon: { fontSize: 44, marginBottom: spacing.sm },
  body: { marginTop: spacing.sm, marginBottom: spacing.lg },
  allow: { marginBottom: spacing.xs },
});
