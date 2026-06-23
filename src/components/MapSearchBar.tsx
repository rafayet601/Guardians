import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { colors, radius, shadow, spacing, typography } from '@/theme';

interface MapSearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit?: () => void;
  onFilterPress?: () => void;
  submitting?: boolean;
}

/**
 * "Search this area" pill that floats over the map. Search icon left, a
 * filter/options affordance right. Border eases to primary on focus.
 */
export function MapSearchBar({
  value,
  onChangeText,
  onSubmit,
  onFilterPress,
  submitting,
}: MapSearchBarProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.bar, focused && styles.barFocused]}>
      <Ionicons name="search" size={18} color={focused ? colors.primary : colors.textMuted} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmit}
        placeholder="Search this area"
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        autoCorrect={false}
        editable={!submitting}
        accessibilityRole="search"
        accessibilityLabel="Search this area"
      />
      {onFilterPress ? (
        <PressableScale
          onPress={onFilterPress}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Filter sightings"
        >
          <Ionicons name="options-outline" size={19} color={colors.textSecondary} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  barFocused: { borderColor: colors.primary },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    paddingVertical: 0,
  },
});
