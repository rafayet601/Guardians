import { ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, spacing } from '@/theme';

export default function TermsScreen() {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text variant="display">Terms of Service</Text>
      <Text variant="caption" muted style={styles.updated}>
        Effective: July 3, 2026 · Last updated: July 12, 2026
      </Text>

      <Text variant="body" style={styles.para}>
        By creating an account or using Guardians, you agree to these terms.
      </Text>

      <Text variant="heading" style={styles.h2}>
        1. What Guardians is
      </Text>
      <Text variant="body" style={styles.para}>
        Guardians is a community platform where people report cat sightings, volunteer
        &quot;Guardians&quot; coordinate rescues, and adopters offer homes. Guardians is a
        coordination tool, not a rescue service — we do not perform rescues, vet participants, or
        guarantee any outcome, and we are not a party to interactions between users.
      </Text>

      <Text variant="heading" style={styles.h2}>
        2. Your account
      </Text>
      <Text variant="body" style={styles.para}>
        You must be at least 13 (or the minimum age in your region), provide accurate information,
        and keep your credentials secure. You are responsible for activity on your account. You can
        delete your account at any time in Settings.
      </Text>

      <Text variant="heading" style={styles.h2}>
        3. Community rules & user content
      </Text>
      <Text variant="body" style={styles.para}>
        You keep ownership of the content you post (reports, photos, comments) and grant us a
        worldwide, royalty-free license to host and display it so the app can function.
      </Text>
      <Text variant="body" style={styles.para}>
        We have zero tolerance for objectionable content or abusive users. You agree not to:
      </Text>
      <Bullet>post content that is unlawful, harassing, hateful, sexually explicit, violent, or depicts animal cruelty</Bullet>
      <Bullet>post false reports, spam, or content you don&apos;t have the right to share</Bullet>
      <Bullet>harass, stalk, or endanger any person or animal</Bullet>
      <Bullet>attempt to locate a person&apos;s home or identity from rescue data</Bullet>
      <Bullet>interfere with the service, scrape data, or probe its security</Bullet>
      <Text variant="body" style={styles.para}>
        Every listing has a Report action and every user can be blocked. We review reports and act
        on violations — including removing content and terminating accounts — within 24 hours of a
        report. Repeated or serious violations result in a permanent ban.
      </Text>

      <Text variant="heading" style={styles.h2}>
        4. Animal welfare & safety
      </Text>
      <Text variant="body" style={styles.para}>
        Follow local laws on animal handling, rescue, and adoption. Never put yourself or an animal
        at risk; contact professional animal services for dangerous situations. Points, levels, and
        badges are a motivational layer only — they create no employment, agency, or volunteer
        relationship with us.
      </Text>

      <Text variant="heading" style={styles.h2}>
        5. AI-assisted features
      </Text>
      <Text variant="body" style={styles.para}>
        Some features use AI to make suggestions — for example prefilling a report from a photo,
        drafting an adoption listing, flagging content for human moderator review, or suggesting that
        two sightings may show the same cat. AI output is a suggestion, not a fact or professional
        advice: you review and confirm before anything is posted, a human moderator makes all final
        moderation decisions, and nothing in the app provides veterinary or medical advice — always
        contact a qualified professional for an animal&apos;s health.
      </Text>

      <Text variant="heading" style={styles.h2}>
        6. Rewards
      </Text>
      <Text variant="body" style={styles.para}>
        Kibble and reward redemptions have no cash value, are non-transferable, and may be modified
        or discontinued at any time. Offers are fulfilled by the listed brands, not by us.
      </Text>

      <Text variant="heading" style={styles.h2}>
        7. Acceptable-use enforcement
      </Text>
      <Text variant="body" style={styles.para}>
        We may remove content, suspend, or terminate accounts that violate these terms, with or
        without notice. You may stop using the service at any time.
      </Text>

      <Text variant="heading" style={styles.h2}>
        8. Disclaimers & liability
      </Text>
      <Text variant="body" style={styles.para}>
        The service is provided &quot;as is&quot; without warranties of any kind. To the maximum
        extent permitted by law, we are not liable for indirect, incidental, or consequential
        damages, or for the acts or omissions of other users. Our total liability is limited to the
        greater of USD 50 or the amount you paid us in the past 12 months.
      </Text>

      <Text variant="heading" style={styles.h2}>
        9. Changes to these terms
      </Text>
      <Text variant="body" style={styles.para}>
        We may update these terms; material changes will be announced in-app and take effect no
        sooner than 7 days after posting. Continued use means acceptance.
      </Text>

      <Text variant="heading" style={styles.h2}>
        10. Contact
      </Text>
      <Text variant="body" style={styles.para}>
        rafayetquader@gmail.com
      </Text>
    </ScrollView>
  );
}

function Bullet({ children }: { children: string }) {
  return (
    <View style={styles.bulletRow}>
      <Text variant="body">• {children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  updated: { marginTop: spacing.xs, marginBottom: spacing.lg },
  h2: { marginTop: spacing.lg, marginBottom: spacing.sm },
  para: { marginBottom: spacing.sm },
  bulletRow: { marginBottom: spacing.xs, paddingLeft: 8 },
});
