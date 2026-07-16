import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { useRescueCopilot } from '@/hooks/useRescueCopilot';
import { AI_FEATURES } from '@/constants/ai';
import { Button, Card, Input, Pill, Text } from '@/components/ui';
import { notify } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import { colors, motion, radius, spacing } from '@/theme';
import type { RescueCopilotAnswer } from '@/types/aiRag';

/**
 * Rescue copilot (AI-M5 #7) — RAG-grounded Q&A surfaced on a sighting the
 * current user is the assigned guardian for. The card is hidden entirely
 * unless `AI_FEATURES.rescueCopilot` is on AND `isClaimer` is true (a
 * client-side affordance only; the `ai-rescue-copilot` Edge Function
 * re-checks `claimed_by === auth.uid()` server-side, so a non-claimer can
 * never reach the model regardless of what is hidden here).
 *
 * The answer is grounded strictly in the curated KB (migration 0024). When
 * retrieval similarity is low the server returns `hasMatch: false` with a
 * graceful deferral and NO sources — that case is surfaced prominently
 * (separate panel) so the guardian sees the deferral, not a confident
 * non-answer. General guidance only — never veterinary advice.
 */
export function RescueCopilot({
  sightingId,
  isClaimer,
}: {
  sightingId: string;
  isClaimer: boolean;
}): React.ReactNode {
  const reduced = useReducedMotion() ?? false;
  const copilot = useRescueCopilot();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<RescueCopilotAnswer | null>(null);

  if (!AI_FEATURES.rescueCopilot || !isClaimer) return null;

  const onAsk = async () => {
    const q = question.trim();
    if (!q) return;
    try {
      const result = await copilot.mutateAsync({ sightingId, question: q });
      setAnswer(result);
    } catch (e) {
      notify('Copilot unavailable', getErrorMessage(e, 'Please try again.'));
    }
  };

  const onReset = () => {
    setAnswer(null);
    setQuestion('');
  };

  return (
    <Animated.View
      entering={reduced ? FadeInDown.duration(0) : FadeInDown.delay(5 * motion.stagger)
        .duration(motion.enter)
        .springify()
        .damping(motion.damping)}
    >
      <Card style={styles.card}>
        <View style={styles.head}>
          <Text variant="bodyStrong">🧭 Rescue copilot</Text>
          <Text variant="small" muted>
            Ask how to approach, trap, or transport this cat safely.
          </Text>
        </View>

        <Input
          placeholder="e.g. How do I bait the trap for a shy cat?"
          value={question}
          onChangeText={setQuestion}
          multiline
          style={styles.input}
        />

        <Button
          title="Ask"
          onPress={onAsk}
          loading={copilot.isPending}
          disabled={!question.trim() || copilot.isPending}
          fullWidth
        />

        {answer ? (
          <View style={styles.answer}>
            {answer.hasMatch ? (
              <Text variant="body">{answer.answer}</Text>
            ) : (
              <View style={styles.defer}>
                <Text variant="smallStrong" color={colors.urgent}>
                  ⚠️ The copilot doesn&apos;t have a reliable answer for this
                </Text>
                <Text variant="body" style={styles.deferBody}>
                  {answer.answer}
                </Text>
              </View>
            )}

            {answer.sources.length > 0 ? (
              <View style={styles.sources}>
                {answer.sources.map((s, i) => (
                  <View key={`${s.source}-${i}`} style={styles.sourceRow}>
                    <Pill label={s.source} bg={colors.primaryTint} fg={colors.primaryDark} />
                    <Text variant="caption" muted style={styles.sourceTitle}>
                      {s.title}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Text variant="caption" muted style={styles.disclaimer}>
              General guidance from a curated rescue guide — not veterinary advice. Contact a vet
              for anything medical.
            </Text>

            <Button title="Ask another question" variant="ghost" onPress={onReset} fullWidth />
          </View>
        ) : null}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, marginTop: spacing.sm },
  head: { gap: spacing.xs },
  input: { minHeight: 72 },
  answer: { gap: spacing.md, marginTop: spacing.xs },
  defer: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.urgentSoft,
    borderWidth: 1,
    borderColor: colors.urgent,
  },
  deferBody: { marginTop: spacing.xs },
  sources: { gap: spacing.sm },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  sourceTitle: { flexShrink: 1 },
  disclaimer: { marginTop: spacing.xs },
});
