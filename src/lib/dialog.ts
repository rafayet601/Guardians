import { Alert, Platform } from 'react-native';

/**
 * Cross-platform dialogs.
 *
 * React Native's `Alert` is a no-op on web, so these helpers fall back to the
 * browser's native `window.confirm` / `window.alert` there and use `Alert` on
 * iOS/Android. This keeps confirmations and notifications working on every
 * platform instead of silently doing nothing on web.
 */

const isWeb = Platform.OS === 'web';

function joinText(title: string, message?: string): string {
  return message ? `${title}\n\n${message}` : title;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

/** Yes/no confirmation. Resolves true if the user confirms. */
export function confirmAsync({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (isWeb) {
    return Promise.resolve(
      typeof window !== 'undefined' ? window.confirm(joinText(title, message)) : false,
    );
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}

/** Informational / error message. */
export function notify(title: string, message?: string): void {
  if (isWeb) {
    if (typeof window !== 'undefined') window.alert(joinText(title, message));
    return;
  }
  Alert.alert(title, message);
}

export type PhotoSource = 'camera' | 'library';

/**
 * Photo-source chooser. On native this is a 3-option action sheet; on web there
 * is no camera capture sheet, so we go straight to the file/library picker.
 */
export function choosePhotoSource(): Promise<PhotoSource | null> {
  if (isWeb) return Promise.resolve('library');
  return new Promise((resolve) => {
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => resolve('camera') },
      { text: 'Choose from library', onPress: () => resolve('library') },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}
