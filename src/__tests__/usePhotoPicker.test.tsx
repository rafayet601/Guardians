import * as ImagePicker from 'expo-image-picker';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { usePhotoPicker } from '@/hooks/usePhotoPicker';
import { choosePhotoSource, notify } from '@/lib/dialog';
import { hasPrimerBeenShown, markPrimerShown, trackPermissionResult } from '@/lib/permissions';

jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  getCameraPermissionsAsync: jest.fn(),
  getMediaLibraryPermissionsAsync: jest.fn(),
}));
jest.mock('@/lib/dialog', () => ({ choosePhotoSource: jest.fn(), notify: jest.fn() }));
jest.mock('@/lib/permissions', () => ({
  hasPrimerBeenShown: jest.fn(),
  markPrimerShown: jest.fn(async () => {}),
  trackPermissionResult: jest.fn(),
}));

const asset = (uri: string) => ({ uri, width: 10, height: 10 });
const picked = (...uris: string[]) => ({ canceled: false, assets: uris.map(asset) });

const probe: { current?: ReturnType<typeof usePhotoPicker> } = {};
function Probe() {
  const value = usePhotoPicker();
  useEffect(() => {
    probe.current = value;
  });
  return null;
}

let tree: ReactTestRenderer | undefined;
const hook = () => probe.current!;

async function mount() {
  await act(async () => {
    tree = create(<Probe />);
  });
}

function setPlatform(os: 'ios' | 'android') {
  jest.replaceProperty(Platform, 'OS', os);
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.mocked(hasPrimerBeenShown).mockResolvedValue(false);
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(picked('cam.jpg') as never);
  jest
    .mocked(ImagePicker.launchImageLibraryAsync)
    .mockResolvedValue(picked('a.jpg', 'b.jpg', 'c.jpg') as never);
  jest
    .mocked(ImagePicker.requestCameraPermissionsAsync)
    .mockResolvedValue({ granted: true } as never);
  jest
    .mocked(ImagePicker.getCameraPermissionsAsync)
    .mockResolvedValue({ granted: false, canAskAgain: true } as never);
  jest
    .mocked(ImagePicker.getMediaLibraryPermissionsAsync)
    .mockResolvedValue({ granted: true, canAskAgain: true } as never);
  setPlatform('android');
  await mount();
});

afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

test('the library picker takes several photos at once and never asks Android for a permission', async () => {
  jest.mocked(choosePhotoSource).mockResolvedValue('library');
  let result: unknown;
  await act(async () => {
    result = await hook().pick(3);
  });
  expect(result).toHaveLength(3);
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
    expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 3, base64: true }),
  );
  // No forced crop: it cost a step per photo and cut off identifying markings.
  expect(jest.mocked(ImagePicker.launchImageLibraryAsync).mock.calls[0][0]).not.toHaveProperty(
    'allowsEditing',
  );
  expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
});

test('a single free slot uses single selection', async () => {
  jest.mocked(choosePhotoSource).mockResolvedValue('library');
  await act(async () => {
    await hook().pick(1);
  });
  expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
    expect.objectContaining({ allowsMultipleSelection: false, selectionLimit: 1 }),
  );
});

test('never returns more photos than there is room for', async () => {
  jest.mocked(choosePhotoSource).mockResolvedValue('library');
  let result: unknown[] = [];
  await act(async () => {
    result = await hook().pick(2);
  });
  expect(result).toHaveLength(2);
});

test('an already-granted camera launches straight away with no primer and no funnel event', async () => {
  jest.mocked(choosePhotoSource).mockResolvedValue('camera');
  jest
    .mocked(ImagePicker.getCameraPermissionsAsync)
    .mockResolvedValue({ granted: true, canAskAgain: true } as never);
  let result: unknown[] = [];
  await act(async () => {
    result = await hook().pick(4);
  });
  expect(result).toHaveLength(1);
  expect(hook().primer.visible).toBe(false);
  expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  expect(trackPermissionResult).not.toHaveBeenCalled();
});

describe('on iOS, before the OS asks for camera access', () => {
  beforeEach(() => {
    setPlatform('ios');
    jest.mocked(choosePhotoSource).mockResolvedValue('camera');
  });

  test('explains first, then resumes the pick when the person continues', async () => {
    let pending!: Promise<unknown[]>;
    await act(async () => {
      pending = hook().pick(4);
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hook().primer.visible).toBe(true);
    expect(hook().primer.kind).toBe('camera');
    expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();

    await act(async () => {
      await hook().primer.onAllow();
    });
    const result = await pending;
    expect(result).toHaveLength(1);
    expect(markPrimerShown).toHaveBeenCalledWith('camera');
    expect(trackPermissionResult).toHaveBeenCalledWith('camera', 'granted');
    expect(hook().primer.visible).toBe(false);
  });

  test('"Not now" resolves with nothing, remembers the answer and never triggers the OS prompt', async () => {
    let pending!: Promise<unknown[]>;
    await act(async () => {
      pending = hook().pick(4);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(hook().primer.visible).toBe(true);
    await act(async () => {
      await hook().primer.onDismiss();
    });
    expect(await pending).toEqual([]);
    expect(markPrimerShown).toHaveBeenCalledWith('camera');
    expect(trackPermissionResult).toHaveBeenCalledWith('camera', 'dismissed');
    expect(ImagePicker.requestCameraPermissionsAsync).not.toHaveBeenCalled();
  });

  test('an OS denial explains what to do and returns nothing', async () => {
    jest
      .mocked(ImagePicker.requestCameraPermissionsAsync)
      .mockResolvedValue({ granted: false } as never);
    jest.mocked(hasPrimerBeenShown).mockResolvedValue(true); // primer already answered
    let result: unknown[] = ['sentinel'];
    await act(async () => {
      result = await hook().pick(4);
    });
    expect(result).toEqual([]);
    expect(notify).toHaveBeenCalledWith('Permission needed', expect.stringContaining('camera'));
    expect(trackPermissionResult).toHaveBeenCalledWith('camera', 'denied');
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });
});

test('cancelling the source chooser is a quiet no-op', async () => {
  jest.mocked(choosePhotoSource).mockResolvedValue(null);
  let result: unknown[] = ['sentinel'];
  await act(async () => {
    result = await hook().pick(4);
  });
  expect(result).toEqual([]);
  expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  expect(hook().picking).toBe(false);
});

test('does nothing when the report is already full', async () => {
  let result: unknown[] = ['sentinel'];
  await act(async () => {
    result = await hook().pick(0);
  });
  expect(result).toEqual([]);
  expect(choosePhotoSource).not.toHaveBeenCalled();
});

test('a second pick while one is in flight is ignored, so photos are never chosen twice', async () => {
  let release!: (value: 'library') => void;
  jest.mocked(choosePhotoSource).mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  let first!: Promise<unknown[]>;
  let second: unknown[] = ['sentinel'];
  await act(async () => {
    first = hook().pick(4);
    second = await hook().pick(4);
  });
  expect(second).toEqual([]);
  expect(choosePhotoSource).toHaveBeenCalledTimes(1);
  await act(async () => {
    release('library');
    await first;
  });
  expect(hook().picking).toBe(false);
});

test('an unexpected picker failure is reported, not thrown', async () => {
  jest.mocked(choosePhotoSource).mockResolvedValue('library');
  jest.mocked(ImagePicker.launchImageLibraryAsync).mockRejectedValue(new Error('picker crashed'));
  let result: unknown[] = ['sentinel'];
  await act(async () => {
    result = await hook().pick(4);
  });
  expect(result).toEqual([]);
  expect(notify).toHaveBeenCalledWith('Could not add photo', 'picker crashed');
  expect(hook().picking).toBe(false);
});
