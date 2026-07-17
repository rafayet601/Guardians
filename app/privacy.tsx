import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, spacing } from '@/theme';

export default function PrivacyScreen() {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text variant="display">Privacy Policy</Text>
      <Text variant="caption" muted style={styles.updated}>
        Last updated: July 12, 2026
      </Text>

      <Text variant="body" style={styles.para}>
        Guardians (&quot;we&quot;, &quot;us&quot;, the &quot;app&quot;) helps a community rescue
        feral and lost cats by letting people report sightings on a map, claim and complete rescues,
        and place cats in adoptive homes. This policy explains what we collect, why, and who we
        share it with.
      </Text>

      <Text variant="heading" style={styles.h2}>
        What we collect
      </Text>
      <Bullet>
        <Text variant="bodyStrong">Account data</Text>
        <Text variant="body"> — your email/auth identifier, username, and profile details.</Text>
      </Bullet>
      <Bullet>
        <Text variant="bodyStrong">Location</Text>
        <Text variant="body">
          {' '}
          — the location of a sighting you report, and (if you opt in to urgent-help notifications)
          a coarsened &quot;home area&quot; used to notify you about nearby urgent sightings.
          Precise coordinates are never shown to other users.
        </Text>
      </Bullet>
      <Bullet>
        <Text variant="bodyStrong">Photos</Text>
        <Text variant="body"> — images you upload for a sighting or your profile.</Text>
      </Bullet>
      <Bullet>
        <Text variant="bodyStrong">Content you write</Text>
        <Text variant="body"> — report titles/descriptions, rescue updates, comments.</Text>
      </Bullet>
      <Bullet>
        <Text variant="bodyStrong">Usage/diagnostic data</Text>
        <Text variant="body">
          {' '}
          — in-app product events and (optionally) crash reports, used to operate and improve the
          app.
        </Text>
      </Bullet>

      <Text variant="heading" style={styles.h2}>
        How we use it
      </Text>
      <Text variant="body" style={styles.para}>
        We use your data to run the core service (map, rescues, adoptions, gamification), to send
        the notifications you opt into, to keep the community safe (moderation and abuse
        prevention), and to understand and improve how the app is used.
      </Text>

      <Text variant="heading" style={styles.h2}>
        Who we share it with
      </Text>
      <Text variant="body" style={styles.para}>
        We share limited data with service providers that process it only on our behalf:
      </Text>
      <ProcessorRow name="Supabase" purpose="Hosting: database, authentication, file storage" />
      <ProcessorRow name="Expo" purpose="Delivering push notifications" />
      <ProcessorRow name="Google Maps" purpose="Rendering the map" />
      <ProcessorRow name="Sentry (optional)" purpose="Error reporting" />
      <ProcessorRow
        name="Anthropic (Claude API)"
        purpose="AI features (photo-to-report autofill, content moderation)"
      />
      <ProcessorRow
        name="Voyage AI"
        purpose="Embeddings for duplicate-sighting detection, lost-cat matching, and rescue guidance"
      />

      <Text variant="heading" style={styles.h2}>
        AI features
      </Text>
      <Text variant="body" style={styles.para}>
        Some features use AI to make suggestions. When you use them, relevant cat photos and report
        text are sent to Anthropic&apos;s Claude API and Voyage AI. This processing happens
        server-side only — the AI never runs on your device and no AI key is stored in the app. Data
        is processed under zero-retention commercial terms and is never used to train AI models. AI
        output is always a suggestion you review and confirm — it never auto-submits a report or
        takes any irreversible action.
      </Text>

      <Text variant="heading" style={styles.h2}>
        Your choices and rights
      </Text>
      <Text variant="body" style={styles.para}>
        You can delete your account from within the app, which permanently removes your account and
        associated data. You can opt out of urgent-help notifications at any time. You may contact
        us to exercise applicable data rights.
      </Text>

      <Text variant="heading" style={styles.h2}>
        Retention
      </Text>
      <Text variant="body" style={styles.para}>
        We keep your data for as long as your account is active. When you delete your account,
        associated records are removed.
      </Text>

      <Text variant="heading" style={styles.h2}>
        Contact
      </Text>
      <Text variant="body" style={styles.para}>
        Questions about this policy: reach us through the support contact listed on our store
        listing.
      </Text>
    </ScrollView>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return <View style={styles.bullet}>{children}</View>;
}

function ProcessorRow({ name, purpose }: { name: string; purpose: string }) {
  return (
    <View style={styles.processorRow}>
      <Text variant="bodyStrong">{name}</Text>
      <Text variant="small" muted>
        {purpose}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  updated: { marginTop: spacing.xs, marginBottom: spacing.lg },
  h2: { marginTop: spacing.lg, marginBottom: spacing.sm },
  para: { marginBottom: spacing.sm },
  bullet: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xs, paddingLeft: 8 },
  processorRow: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.xs,
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
