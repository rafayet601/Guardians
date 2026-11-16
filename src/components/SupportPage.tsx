import { Link } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { Card, Text } from '@/components/ui';
import { supportEmail, supportMailto } from '@/constants/support';
import { colors, spacing } from '@/theme';

export function SupportPage({ deletion = false }: { deletion?: boolean }) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.page}
      contentContainerStyle={styles.content}
    >
      <Text variant="display">
        {deletion ? 'Delete your Guardians account' : 'Guardians support'}
      </Text>
      <Text variant="body">
        Get help with your account, report a problem, or request account and data deletion. You can
        contact us without signing in or reinstalling the app.
      </Text>
      <Card>
        <Text variant="heading">Contact us</Text>
        <Text selectable color={colors.primary}>
          <Link href={supportMailto()}>{supportEmail}</Link>
        </Text>
        <Text variant="small" muted>
          For abuse reports, include the listing link and a short description. Never send passwords,
          sign-in links, ID photos, or precise private locations by email.
        </Text>
      </Card>
      <Card>
        <Text variant="heading">Request account deletion</Text>
        <Text variant="body">
          In the app, open Settings and choose Delete account. If you cannot use the app, email us
          from the address registered with Guardians with the subject “Guardians account deletion
          request”. Include your username if you know it. We verify account ownership before
          deleting any account; an email request alone does not authorize deletion of another
          person’s data.
        </Text>
        <Text selectable color={colors.primary}>
          <Link href={supportMailto(true)}>Email an account deletion request</Link>
        </Text>
      </Card>
      <Card>
        <Text variant="heading">What deletion removes</Text>
        <Text variant="body">
          Deletion permanently removes your account, profile, authored reports and comments,
          uploaded photos and screening documents, rewards, push registrations, and linked usage
          records from active systems. Other people’s community records can remain without your
          account association. Backups and service providers follow their applicable retention
          policies. Deleted accounts cannot be restored through the app.
        </Text>
      </Card>
      {!deletion && (
        <Link href="/delete-account" style={styles.link}>
          Account deletion details
        </Link>
      )}
      <Link href="/privacy" style={styles.link}>
        Privacy Policy
      </Link>
      <Link href="/terms" style={styles.link}>
        Terms of Service
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center',
  },
  link: { color: colors.primary },
});
