import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { colors, palette } from '@/theme';
import { initialsOf } from '@/utils/format';
import { Text } from './Text';

export interface AvatarProps {
  url?: string | null;
  name?: string | null;
  size?: number;
}

const SWATCHES = [
  palette.green500,
  palette.amber500,
  palette.blue500,
  palette.violet500,
  palette.pink500,
];

function colorFor(name?: string | null): string {
  if (!name) return palette.green500;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return SWATCHES[Math.abs(hash) % SWATCHES.length];
}

export function Avatar({ url, name, size = 44 }: AvatarProps) {
  const dim = { width: size, height: size, borderRadius: size / 2 };

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.base, dim]}
        contentFit="cover"
        transition={150}
      />
    );
  }

  return (
    <View style={[styles.base, dim, { backgroundColor: colorFor(name) }]}>
      <Text
        color={colors.white}
        style={{ fontSize: size * 0.38, fontWeight: '700' }}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
});
