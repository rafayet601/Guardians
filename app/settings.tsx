import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { uploadAvatar } from '@/api/storage';
import { confirmAsync, notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { hasPrimerBeenShown, markPrimerShown, trackPermissionResult } from '@/lib/permissions';
import { getPushOptIn, registerForPush, setPushOptIn } from '@/lib/push';
import { PermissionPrimer } from '@/components/PermissionPrimer';
import { PressableScale } from '@/components/PressableScale';
import { Avatar, Button, EmptyState, Input, Loading, Text } from '@/components/ui';
import { useMyProfile, useUpdateProfile } from '@/hooks/useProfile';
import { useAuth } from '@/providers/AuthProvider';
import type { Profile } from '@/types/models';
import { colors, motion, radius, shadow, spacing } from '@/theme';

export default function SettingsScreen() {
  const { data: profile, isLoading, refetch } = useMyProfile();
  if (isLoading) return <Loading />;
  if (!profile)
    return (
      <EmptyState
        title="Could not load your profile"
        message="Check your connection and try again."
        actionLabel="Try again"
        onAction={() => refetch()}
      />
    );
  return <SettingsForm key={profile.id} profile={profile} />;
}

function SettingsForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const { user, signOut, deleteAccount } = useAuth();
  const updateProfile = useUpdateProfile();

  const [username, setUsername] = useState(profile.username);
  const [fullName, setFullName] = useState(profile.full_name ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatar_url);
  const [isGuardian, setIsGuardian] = useState(profile.is_guardian);
  const [wantsToAdopt, setWantsToAdopt] = useState(profile.wants_to_adopt);
  const [pushBusy, setPushBusy] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushPrimerVisible, setPushPrimerVisible] = useState(false);
  const [avatarPrimerVisible, setAvatarPrimerVisible] = useState(false);

  // Reflect the stored push opt-in choice in the notifications toggle.
  useEffect(() => {
    let active = true;
    (async () => {
      const optedIn = await getPushOptIn(user?.id ?? '');
      if (active) setPushEnabled(optedIn);
    })();
    return () => {
      active = false;
    };
  }, [user?.id]);

  const reduced = useReducedMotion() ?? false;

  const launchAvatarPicker = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
      base64: true,
    });
    if (result.canceled || !result.assets[0] || !user) return;
    setUploading(true);
    try {
      const url = await uploadAvatar(user.id, {
        uri: result.assets[0].uri,
        mimeType: result.assets[0].mimeType,
        base64: result.assets[0].base64,
      });
      setAvatarUrl(url);
    } catch (e) {
      notify('Upload failed', getErrorMessage(e, 'Try again.'));
    } finally {
      setUploading(false);
    }
  };

  // OS request + outcome tracking. Only called when a real OS decision is
  // pending, so already-granted launches stay out of the funnel.
  const requestAvatarPermission = async (): Promise<boolean> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    trackPermissionResult('mediaLibrary', perm.granted ? 'granted' : 'denied');
    if (!perm.granted) {
      notify('Permission needed', 'Please allow photo library access to change your photo.');
      return false;
    }
    return true;
  };

  // Prime once before the OS photo-library prompt (P1-1), mirroring report.tsx.
  const changeAvatar = async () => {
    if (Platform.OS !== 'ios') {
      await launchAvatarPicker();
      return;
    }
    const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (existing.granted) {
      await launchAvatarPicker(); // already granted — no prompt, no funnel event
      return;
    }
    if (existing.canAskAgain && !(await hasPrimerBeenShown('mediaLibrary'))) {
      setAvatarPrimerVisible(true); // prime once; "Continue" resumes the flow
      return;
    }
    if (await requestAvatarPermission()) await launchAvatarPicker();
  };

  const allowAvatarPrimer = async () => {
    setAvatarPrimerVisible(false);
    await markPrimerShown('mediaLibrary');
    if (await requestAvatarPermission()) await launchAvatarPicker();
  };

  const dismissAvatarPrimer = async () => {
    setAvatarPrimerVisible(false);
    await markPrimerShown('mediaLibrary');
    trackPermissionResult('mediaLibrary', 'dismissed');
  };

  // Opt in + register. The switch only flips on once the choice persists.
  const enablePush = async (): Promise<string | null> => {
    try {
      await setPushOptIn(user?.id ?? '', true);
      const token = await registerForPush(user?.id ?? '');
      if (!token) {
        await setPushOptIn(user?.id ?? '', false);
        throw new Error(
          'Alerts are unavailable. Check notification permission in your device settings and try again.',
        );
      }
      setPushEnabled(true);
      return token;
    } catch (e) {
      setPushEnabled(false);
      notify('Could not enable alerts', getErrorMessage(e, 'Please try again.'));
      return null;
    }
  };

  const onTogglePush = async (next: boolean) => {
    if (!next) {
      setPushEnabled(false);
      try {
        await setPushOptIn(user?.id ?? '', false); // also disables pushes server-side
      } catch (e) {
        setPushEnabled(true);
        notify('Could not update', getErrorMessage(e, 'Please try again.'));
      }
      return;
    }
    if (await hasPrimerBeenShown('notifications', user?.id)) {
      await enablePush();
    } else {
      setPushPrimerVisible(true); // prime once; "Continue" resumes the flow
    }
  };

  const allowPushPrimer = async () => {
    setPushPrimerVisible(false);
    await markPrimerShown('notifications', user?.id);
    const token = await enablePush();
    trackPermissionResult('notifications', token ? 'granted' : 'denied');
  };

  const dismissPushPrimer = async () => {
    setPushPrimerVisible(false);
    await markPrimerShown('notifications', user?.id);
    setPushEnabled(false);
    trackPermissionResult('notifications', 'dismissed');
  };

  const save = () => {
    if (username.trim().length < 3) {
      notify('Invalid username', 'Username must be at least 3 characters.');
      return;
    }
    updateProfile.mutate(
      {
        username: username.trim(),
        full_name: fullName.trim() || null,
        bio: bio.trim() || null,
        avatar_url: avatarUrl,
        is_guardian: isGuardian,
        wants_to_adopt: wantsToAdopt,
      },
      {
        onSuccess: () => {
          notify('Saved', 'Your profile has been updated.');
          router.back();
        },
        onError: (e) => notify('Could not save', getErrorMessage(e, 'Try again.')),
      },
    );
  };

  const confirmSignOut = async () => {
    const ok = await confirmAsync({
      title: 'Sign out?',
      confirmLabel: 'Sign out',
      destructive: true,
    });
    if (!ok || accountBusy) return;
    setAccountBusy(true);
    try {
      await signOut();
    } catch (e) {
      notify('Could not sign out', getErrorMessage(e, 'Please reconnect and try again.'));
    } finally {
      setAccountBusy(false);
    }
  };

  const confirmDelete = async () => {
    const ok = await confirmAsync({
      title: 'Delete your account?',
      message:
        'This permanently deletes your profile, reports, points, and rewards. This cannot be undone.',
      confirmLabel: 'Delete account',
      destructive: true,
    });
    if (!ok || accountBusy) return;
    setAccountBusy(true);
    try {
      await deleteAccount();
      // the root layout redirects to /welcome once the session clears
    } catch (e) {
      notify('Could not delete account', getErrorMessage(e, 'Please try again.'));
    } finally {
      setAccountBusy(false);
    }
  };

  const enter = (i: number) => {
    if (reduced) return FadeInDown.duration(0);
    return FadeInDown.delay(i * motion.stagger)
      .duration(motion.enter)
      .springify()
      .damping(motion.damping);
  };

  return (
    <>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View entering={enter(0)}>
          <PressableScale
            style={styles.avatarPick}
            onPress={changeAvatar}
            disabled={uploading}
            scaleTo={0.97}
          >
            <Avatar url={avatarUrl} name={username} size={88} />
            <Text variant="smallStrong" color={colors.primary}>
              {uploading ? 'Uploading…' : 'Change photo'}
            </Text>
          </PressableScale>
        </Animated.View>

        <Animated.View entering={enter(1)}>
          <Input
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Animated.View>
        <Animated.View entering={enter(2)}>
          <Input
            label="Full name"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Optional"
          />
        </Animated.View>
        <Animated.View entering={enter(3)}>
          <Input
            label="Bio"
            value={bio}
            onChangeText={setBio}
            placeholder="Tell the community about yourself"
            multiline
          />
        </Animated.View>

        <Animated.View entering={enter(4)} style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text variant="bodyStrong">🦸 I'm a Guardian</Text>
            <Text variant="small" muted>
              Get involved in rescuing cats.
            </Text>
          </View>
          <Switch
            value={isGuardian}
            onValueChange={setIsGuardian}
            trackColor={{ true: colors.primaryLight, false: colors.border }}
            thumbColor={colors.white}
            accessibilityRole="switch"
            accessibilityState={{ checked: isGuardian }}
            accessibilityLabel="I'm a Guardian"
          />
        </Animated.View>

        <Animated.View entering={enter(5)} style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text variant="bodyStrong">🏠 Open to adopting</Text>
            <Text variant="small" muted>
              Show interest in giving cats a forever home.
            </Text>
          </View>
          <Switch
            value={wantsToAdopt}
            onValueChange={setWantsToAdopt}
            trackColor={{ true: colors.primaryLight, false: colors.border }}
            thumbColor={colors.white}
            accessibilityRole="switch"
            accessibilityState={{ checked: wantsToAdopt }}
            accessibilityLabel="Open to adopting"
          />
        </Animated.View>

        <Animated.View entering={enter(6)} style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text variant="bodyStrong">🔔 Rescue alerts</Text>
            <Text variant="small" muted>
              Get notified when a cat near you needs urgent help.
            </Text>
          </View>
          <Switch
            value={pushEnabled}
            disabled={pushBusy}
            onValueChange={async (next) => {
              setPushBusy(true);
              try {
                await onTogglePush(next);
              } finally {
                setPushBusy(false);
              }
            }}
            trackColor={{ true: colors.primaryLight, false: colors.border }}
            thumbColor={colors.white}
            accessibilityRole="switch"
            accessibilityState={{ checked: pushEnabled }}
            accessibilityLabel="Rescue alerts"
          />
        </Animated.View>

        <Animated.View entering={enter(7)}>
          <Button
            title="Save changes"
            size="lg"
            fullWidth
            loading={updateProfile.isPending}
            onPress={save}
            style={styles.save}
          />
          <Button
            title="Sign out"
            variant="danger"
            fullWidth
            loading={accountBusy}
            onPress={confirmSignOut}
            style={styles.signOut}
          />
          <PressableScale
            disabled={accountBusy}
            onPress={confirmDelete}
            style={styles.deleteLink}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <Text variant="smallStrong" color={colors.danger} center>
              Delete account
            </Text>
          </PressableScale>
        </Animated.View>

        <Animated.View entering={enter(8)} style={styles.legalSection}>
          <PressableScale
            onPress={() => router.push('/blocked-users' as any)}
            style={styles.legalRow}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Blocked users"
          >
            <Text variant="bodyStrong">Blocked users</Text>
          </PressableScale>
          <PressableScale
            onPress={() => router.push('/privacy' as any)}
            style={styles.legalRow}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Privacy Policy"
          >
            <Text variant="bodyStrong">Privacy Policy</Text>
          </PressableScale>
          <PressableScale
            onPress={() => router.push('/terms' as any)}
            style={styles.legalRow}
            hitSlop={8}
            accessibilityRole="link"
            accessibilityLabel="Terms of Service"
          >
            <Text variant="bodyStrong">Terms of Service</Text>
          </PressableScale>
        </Animated.View>
      </ScrollView>

      {/* One-time permission primers (P1-1) */}
      <PermissionPrimer
        visible={pushPrimerVisible}
        kind="notifications"
        onAllow={allowPushPrimer}
        onDismiss={dismissPushPrimer}
      />
      <PermissionPrimer
        visible={avatarPrimerVisible}
        kind="mediaLibrary"
        onAllow={allowAvatarPrimer}
        onDismiss={dismissAvatarPrimer}
      />
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  avatarPick: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    ...shadow.card,
  },
  toggleText: { flex: 1, gap: 2 },
  save: { marginTop: spacing.sm },
  signOut: { marginTop: spacing.xs },
  deleteLink: { marginTop: spacing.lg, paddingVertical: spacing.sm },
  legalSection: { gap: spacing.sm, marginTop: spacing.lg },
  legalRow: { paddingVertical: spacing.sm },
});
