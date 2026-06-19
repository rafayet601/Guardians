import { StyleSheet, View, ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';
import { Text } from './Text';

export interface PillProps {
  label: string;
  icon?: string;
  fg?: string;
  bg?: string;
  style?: ViewStyle;
}

export function Pill({ label, icon, fg = colors.text, bg = colors.divider, style }: PillProps) {
  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      <Text variant="smallStrong" color={fg}>
        {icon ? `${icon} ` : ''}
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
});
