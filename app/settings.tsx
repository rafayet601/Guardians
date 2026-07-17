import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { uploadAvatar } from '@/api/storage';
import { confirmAsync, notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { PressableScale } from '@/components/PressableScale';
import { Avatar, Button, Input, Loading, Text } from '@/components/ui';
import { useMyProfile, useUpdateProfile } from '@/hooks/useProfile';
import { useAuth } from '@/providers/AuthProvider';
import { colors, motion, radius, shadow, spacing } from '@/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, signOut, deleteAccount } = useAuth();
  const { data: profile, isLoading } = useMyProfile();
  const updateProfile = useUpdateProfile();

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isGuardian, setIsGuardian] = useState(false);
  const [wantsToAdopt, setWantsToAdopt] = useState(false);
  const [uploading, setUploading] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username);
    setFullName(profile.full_name ?? '');
    setBio(profile.bio ?? '');
    setAvatarUrl(profile.avatar_url);
    setIsGuardian(profile.is_guardian);
    setWantsToAdopt(profile.wants_to_adopt);
  }, [profile]);

  if (isLoading || !profile) return <Loading />;

  const changeAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
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
    if (ok) signOut();
  };

  const confirmDelete = async () => {
    const ok = await confirmAsync({
      title: 'Delete your account?',
      message:
        'This permanently deletes your profile, reports, points, and rewards. This cannot be undone.',
      confirmLabel: 'Delete account',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteAccount();
      // the root layout redirects to /welcome once the session clears
    } catch (e) {
      notify('Could not delete account', getErrorMessage(e, 'Please try again.'));
    }
  };

  const enter = (i: number) =>
    FadeInDown.delay(i * motion.stagger)
      .duration(motion.enter)
      .springify()
      .damping(motion.damping);

  return (
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
        />
      </Animated.View>

      <Animated.View entering={enter(6)}>
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
          onPress={confirmSignOut}
          style={styles.signOut}
        />
        <PressableScale onPress={confirmDelete} style={styles.deleteLink} hitSlop={8}>
          <Text variant="smallStrong" color={colors.danger} center>
            Delete account
          </Text>
        </PressableScale>
      </Animated.View>

      <Animated.View entering={enter(7)} style={styles.legalSection}>
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
