import { Component, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { captureError } from '@/lib/observability';
import { colors, spacing } from '@/theme';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a single broken screen can't white-screen the
 * whole app. Reports through the observability façade and offers a recovery.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    captureError(error, { source: 'boundary', componentStack: info.componentStack ?? undefined });
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.emoji}>🙀</Text>
          <Text variant="title" center>
            Something went wrong
          </Text>
          <Text variant="body" muted center style={styles.message}>
            The app hit an unexpected error. You can try again — your data is safe.
          </Text>
          <Button title="Try again" onPress={this.reset} style={styles.button} />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  emoji: { fontSize: 56, marginBottom: spacing.xs },
  message: { maxWidth: 300 },
  button: { marginTop: spacing.md },
});
