/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement as mockCreateElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import LostCatScreen from '../../app/lost-cat';
import { uploadCatPhoto } from '@/api/storage';
import { createAccountCacheBoundary } from '@/lib/accountCache';
import { notify } from '@/lib/dialog';

let mockUserId = 'alice';
const mockCreate = jest.fn();
const mockRequest = jest.fn(async () => ({ lat: 40, lng: -73 }));
const mockContainer = ({ children }: { children: ReactNode }) =>
  mockCreateElement('div', {}, children);
const mockPressable = ({ children, onPress }: { children: ReactNode; onPress: () => void }) =>
  mockCreateElement('button', { onClick: onPress }, children);

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('expo-image', () => ({ Image: () => mockCreateElement('div', {}, 'Selected photo') }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: (props: { children: ReactNode }) => mockContainer(props) },
  useReducedMotion: () => true,
  FadeInDown: { duration: () => undefined },
}));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.create(actual, {
    Platform: { value: { OS: 'web' } },
    StyleSheet: { value: { create: (styles: unknown) => styles } },
    View: { value: (props: { children: ReactNode }) => mockContainer(props) },
    ScrollView: { value: (props: { children: ReactNode }) => mockContainer(props) },
    Pressable: {
      value: (props: { children: ReactNode; onPress: () => void }) => mockPressable(props),
    },
  });
});
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/constants/ai', () => ({ AI_FEATURES: { lostCatReunion: true } }));
jest.mock('@/api/storage', () => ({ uploadCatPhoto: jest.fn() }));
jest.mock('@/hooks/useLostCat', () => ({
  useCreateLostCat: () => ({ mutateAsync: mockCreate }),
  useMyLostCats: () => ({ data: [], isLoading: false }),
}));
jest.mock('@/hooks/useLocation', () => ({
  useCurrentLocation: () => ({ coords: { lat: 40, lng: -73 }, request: mockRequest }),
}));
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('expo-image-picker', () => ({
  getMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file://alice-photo', base64: 'synthetic-image' }],
  })),
}));
jest.mock('@/lib/permissions', () => ({ trackPermissionResult: jest.fn() }));
jest.mock('@/lib/dialog', () => ({
  choosePhotoSource: jest.fn(async () => 'library'),
  notify: jest.fn(),
}));
jest.mock('@/components/MapSearchBar', () => ({ MapSearchBar: () => null }));
jest.mock('@/components/PermissionPrimer', () => ({ PermissionPrimer: () => null }));
jest.mock('@/components/PressableScale', () => ({
  PressableScale: (props: { children: ReactNode; onPress: () => void }) => mockPressable(props),
}));
jest.mock('@/components/ui', () => ({
  Card: (props: { children: ReactNode }) => mockContainer(props),
  Text: (props: { children: ReactNode }) => mockContainer(props),
  Pill: () => null,
  Button: ({ title, onPress }: { title: string; onPress: () => void }) =>
    mockCreateElement('button', { onClick: onPress }, title),
  Input: ({
    label,
    value,
    onChangeText,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
  }) =>
    mockCreateElement('input', {
      'aria-label': label,
      value,
      onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
    }),
}));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
let changeAccount: ReturnType<typeof createAccountCacheBoundary>;

function renderScreen() {
  root.render(
    <QueryClientProvider client={client}>
      <LostCatScreen />
    </QueryClientProvider>,
  );
}

function button(title: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((element) =>
    element.textContent?.includes(title),
  );
  if (!found) throw new Error(`Button not found: ${title}`);
  return found;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockUserId = 'alice';
  client = new QueryClient();
  changeAccount = createAccountCacheBoundary(client);
  changeAccount('alice');
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => renderScreen());
  await act(async () => button('Add a photo of your cat').click());
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});

test('account changes remove the previous account photo from the lost-cat form', async () => {
  expect(container.textContent).toContain('Selected photo');
  await act(async () => {
    changeAccount('bob');
    mockUserId = 'bob';
    renderScreen();
  });
  expect(container.textContent).not.toContain('Selected photo');
});

test('a pending upload cannot post the old account lost-cat details for the next account', async () => {
  let finishUpload!: (url: string) => void;
  jest.mocked(uploadCatPhoto).mockReturnValueOnce(
    new Promise((resolve) => {
      finishUpload = resolve;
    }),
  );
  await act(async () => button('Post and start watching').click());
  expect(uploadCatPhoto).toHaveBeenCalledWith('alice', expect.any(Object));
  await act(async () => {
    changeAccount('bob');
    mockUserId = 'bob';
    renderScreen();
    finishUpload('https://synthetic.example/alice/photo.jpg');
  });
  expect(mockCreate).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});

test('the same-account upload still creates a lost-cat post', async () => {
  jest.mocked(uploadCatPhoto).mockResolvedValueOnce('https://synthetic.example/alice/photo.jpg');
  mockCreate.mockResolvedValueOnce({ id: 'synthetic-cat' });
  await act(async () => button('Post and start watching').click());
  expect(mockCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      photoUrl: 'https://synthetic.example/alice/photo.jpg',
      lat: 40,
      lng: -73,
    }),
  );
  expect(notify).toHaveBeenCalledWith('Posted 🐾', expect.any(String));
});
