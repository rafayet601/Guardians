import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';
import { Platform } from 'react-native';

import { choosePhotoSource, notify, type PhotoSource } from '@/lib/dialog';
import { getErrorMessage } from '@/lib/errors';
import {
  hasPrimerBeenShown,
  markPrimerShown,
  trackPermissionResult,
  type PermissionKind,
} from '@/lib/permissions';

export type PickedPhoto = ImagePicker.ImagePickerAsset;

const kindForSource = (source: PhotoSource): PermissionKind =>
  source === 'camera' ? 'camera' : 'mediaLibrary';

interface PendingPrimer {
  source: PhotoSource;
  room: number;
}

/**
 * Photo capture with the app's permission priming (P1-1): a value-explaining
 * primer appears once per permission before the OS prompt, and every outcome
 * is tracked. One place for the flow, so the report, the lost-cat form and the
 * "add a photo to this report" action all behave identically.
 *
 * `pick(room)` resolves with 0..room assets and never throws. Render
 * `<PermissionPrimer {...primer} />`-style from the returned `primer` props.
 */
export function usePhotoPicker() {
  const [primer, setPrimer] = useState<PendingPrimer | null>(null);
  const [picking, setPicking] = useState(false);
  const lock = useRef(false);
  const resumePrimer = useRef<((assets: PickedPhoto[]) => void) | null>(null);

  // No forced crop: it made every photo a two-step chore and cut away the
  // markings Guardians use to recognise a cat. The library picker takes several
  // photos in one go.
  const launch = async (mode: PhotoSource, room: number): Promise<PickedPhoto[]> => {
    const result =
      mode === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true })
        : await ImagePicker.launchImageLibraryAsync({
            quality: 0.6,
            base64: true,
            allowsMultipleSelection: room > 1,
            selectionLimit: room,
          });
    return result.canceled ? [] : result.assets.slice(0, room);
  };

  // OS request + outcome tracking. Only called when a real OS decision is
  // pending, so already-granted launches stay out of the funnel.
  const request = async (mode: PhotoSource, room: number): Promise<PickedPhoto[]> => {
    const kind = kindForSource(mode);
    const permission =
      mode === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    trackPermissionResult(kind, permission.granted ? 'granted' : 'denied');
    if (!permission.granted) {
      notify('Permission needed', `Please allow ${mode} access to add a photo.`);
      return [];
    }
    return launch(mode, room);
  };

  const pickFrom = async (mode: PhotoSource, room: number): Promise<PickedPhoto[]> => {
    // Android's photo picker and the web file input need no permission.
    if (mode !== 'camera' && Platform.OS !== 'ios') return launch(mode, room);
    const kind = kindForSource(mode);
    const existing =
      mode === 'camera'
        ? await ImagePicker.getCameraPermissionsAsync()
        : await ImagePicker.getMediaLibraryPermissionsAsync();
    if (existing.granted) return launch(mode, room); // already granted: no prompt, no funnel event
    if (existing.canAskAgain && !(await hasPrimerBeenShown(kind))) {
      // Prime once. The primer's buttons resume this call.
      return new Promise<PickedPhoto[]>((resolve) => {
        resumePrimer.current = resolve;
        setPrimer({ source: mode, room });
      });
    }
    return request(mode, room);
  };

  const settlePrimer = () => {
    const resolve = resumePrimer.current;
    resumePrimer.current = null;
    return resolve;
  };

  const allowPrimer = async () => {
    const current = primer;
    const resolve = settlePrimer();
    setPrimer(null);
    if (!current) {
      resolve?.([]);
      return;
    }
    try {
      await markPrimerShown(kindForSource(current.source));
      resolve?.(await request(current.source, current.room));
    } catch (error) {
      notify('Could not add photo', getErrorMessage(error, 'Please try choosing the photo again.'));
      resolve?.([]);
    }
  };

  const dismissPrimer = async () => {
    const current = primer;
    const resolve = settlePrimer();
    setPrimer(null);
    if (current) {
      await markPrimerShown(kindForSource(current.source));
      trackPermissionResult(kindForSource(current.source), 'dismissed');
    }
    resolve?.([]);
  };

  const pick = async (room: number): Promise<PickedPhoto[]> => {
    if (lock.current || room <= 0) return [];
    lock.current = true;
    setPicking(true);
    try {
      const source = await choosePhotoSource();
      return source ? await pickFrom(source, room) : [];
    } catch (error) {
      notify('Could not add photo', getErrorMessage(error, 'Please try choosing the photo again.'));
      return [];
    } finally {
      lock.current = false;
      setPicking(false);
    }
  };

  return {
    pick,
    picking,
    primer: {
      visible: primer !== null,
      kind: primer ? kindForSource(primer.source) : ('camera' as PermissionKind),
      onAllow: allowPrimer,
      onDismiss: dismissPrimer,
    },
  };
}
