/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement as mockCreateElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import ScreeningScreen from '../../app/adopt/screening';
import { submitScreening, uploadScreeningDoc } from '@/api/screening';
import { createAccountCacheBoundary } from '@/lib/accountCache';
import type { AdopterScreening } from '@/types/models';

let mockUserId = 'alice';
let mockScreening: AdopterScreening | null = null;
const mockRefetch = jest.fn();
const mockVerify = jest.fn();
const mockRouter = { back: jest.fn() };

jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/hooks/useScreening', () => ({
  useMyScreening: () => ({ data: mockScreening, isLoading: false, refetch: mockRefetch }),
  useSubmitScreening: () => ({ isPending: false }),
  useStartIdVerification: () => ({ mutateAsync: mockVerify }),
}));
jest.mock('@/api/screening', () => ({ submitScreening: jest.fn(), uploadScreeningDoc: jest.fn() }));
jest.mock('@/lib/dialog', () => ({
  choosePhotoSource: jest.fn(async () => 'library'),
  notify: jest.fn(),
}));
jest.mock('@/lib/pushPrompt', () => ({ requestPushPrompt: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: 'file://private-id', mimeType: 'image/jpeg', base64: 'private-image' }],
  })),
}));
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return Object.create(actual, {
    StyleSheet: { value: { create: (styles: unknown) => styles } },
    View: {
      value: ({ children }: { children: ReactNode }) => mockCreateElement('div', {}, children),
    },
    Switch: {
      value: ({
        value,
        onValueChange,
        accessibilityLabel,
      }: {
        value: boolean;
        onValueChange: (value: boolean) => void;
        accessibilityLabel: string;
      }) =>
        mockCreateElement('input', {
          type: 'checkbox',
          checked: value,
          'aria-label': accessibilityLabel,
          onChange: () => onValueChange(!value),
        }),
    },
  });
});
jest.mock('@/components/ui', () => ({
  Loading: () => mockCreateElement('div', {}, 'Loading'),
  Screen: ({ children }: { children: ReactNode }) => mockCreateElement('div', {}, children),
  Card: ({ children }: { children: ReactNode }) => mockCreateElement('div', {}, children),
  Text: ({ children }: { children: ReactNode }) => mockCreateElement('div', {}, children),
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
      <ScreeningScreen />
    </QueryClientProvider>,
  );
}

function button(title: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === title,
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
  mockScreening = {
    user_id: 'alice',
    full_name: 'Alice Private',
    dob: '1990-01-01',
    phone: '555-0100',
    address_line: '123 Private Street',
    city: 'Portland',
    postal: '97201',
    housing: 'own',
    household_adults: 1,
    household_children: 0,
    other_pets: false,
    hours_alone: 4,
    home_visit_consent: true,
    cruelty_attestation: true,
    status: 'pending',
    id_status: 'pending',
    id_doc_paths: ['alice/existing.jpg'],
    reasons: [],
  } as unknown as AdopterScreening;
  client = new QueryClient();
  changeAccount = createAccountCacheBoundary(client);
  changeAccount('alice');
  container = document.createElement('div');
  root = createRoot(container);
  await act(async () => renderScreen());
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
});

test('account changes discard locally retained legal identity and ID document selections', async () => {
  expect(container.querySelector<HTMLInputElement>('[aria-label="Full legal name"]')?.value).toBe(
    'Alice Private',
  );
  await act(async () => button('📷 Add ID photo').click());
  expect(container.textContent).toContain('1/2 added');
  await act(async () => {
    changeAccount('bob');
    mockUserId = 'bob';
    mockScreening = null;
    renderScreen();
  });
  expect(container.querySelector<HTMLInputElement>('[aria-label="Full legal name"]')?.value).toBe(
    '',
  );
  expect(container.textContent).not.toContain('1/2 added');
});

test('an ID upload finishing after an account switch cannot submit the previous person questionnaire', async () => {
  let finishUpload!: (path: string) => void;
  jest.mocked(uploadScreeningDoc).mockReturnValue(
    new Promise((resolve) => {
      finishUpload = resolve;
    }),
  );
  await act(async () => button('📷 Add ID photo').click());
  await act(async () => {
    container.querySelector<HTMLInputElement>('[aria-label^="I consent to"]')?.click();
    button('Submit background check').click();
  });
  expect(uploadScreeningDoc).toHaveBeenCalledWith(
    'alice',
    expect.objectContaining({ base64: 'private-image' }),
  );
  await act(async () => {
    changeAccount('bob');
    mockUserId = 'bob';
    mockScreening = null;
    renderScreen();
    finishUpload('alice/new-id.jpg');
  });
  expect(submitScreening).not.toHaveBeenCalled();
  expect(mockVerify).not.toHaveBeenCalled();
  expect(mockRefetch).not.toHaveBeenCalled();
  expect(mockRouter.back).not.toHaveBeenCalled();
});
