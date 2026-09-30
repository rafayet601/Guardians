/** @jest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useReportDraft } from '@/hooks/useReportDraft';
import { createReportDraftStore, emptyReportDraft } from '@/lib/reportDraft';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
  };
}

const savedDraft = {
  ...emptyReportDraft(),
  title: 'Tabby at the park',
  marker: { latitude: 40, longitude: -73 },
};

describe('report draft storage', () => {
  it('restores valid details only to the same account and excludes temporary photos', async () => {
    const storage = memoryStorage();
    const store = createReportDraftStore(storage);
    const withPhoto = {
      ...savedDraft,
      photos: [{ uri: 'temporary-file', base64: 'private-image' }],
    };
    await store.save('alice', withPhoto);
    expect(await store.load('alice')).toEqual(savedDraft);
    expect(await store.load('bob')).toBeNull();
    expect([...storage.values.values()][0]).not.toContain('private-image');
  });

  it('waits for a pending save before clearing and before a later restoration', async () => {
    const storage = memoryStorage();
    let finishSave!: () => void;
    storage.setItem.mockImplementationOnce(
      (key, value) =>
        new Promise<void>((resolve) => {
          finishSave = () => {
            storage.values.set(key, value);
            resolve();
          };
        }),
    );
    const store = createReportDraftStore(storage);
    const save = store.save('alice', savedDraft);
    const clear = store.clear('alice');
    const restore = store.load('alice');
    await Promise.resolve();
    await Promise.resolve();
    expect(storage.removeItem).not.toHaveBeenCalled();
    finishSave();
    await Promise.all([save, clear]);
    expect(await restore).toBeNull();
  });

  it('recovers from failed storage operations without poisoning the next save', async () => {
    const storage = memoryStorage();
    storage.setItem.mockRejectedValueOnce(new Error('Disk full'));
    const store = createReportDraftStore(storage);
    await expect(store.save('alice', savedDraft)).rejects.toThrow('Disk full');
    await store.save('alice', { ...savedDraft, title: 'Updated' });
    expect((await store.load('alice'))?.title).toBe('Updated');
  });

  it('rejects corrupt drafts and invalid locations without deleting the saved value', async () => {
    const storage = memoryStorage();
    storage.getItem.mockResolvedValueOnce('{broken');
    const store = createReportDraftStore(storage);
    await expect(store.load('alice')).rejects.toThrow('could not be read');
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(() =>
      store.save('alice', { ...savedDraft, marker: { latitude: 400, longitude: 0 } }),
    ).toThrow();
  });
});

describe('report draft hydration', () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useReportDraft>;
  const getItem = jest.mocked(AsyncStorage.getItem);
  const setItem = jest.mocked(AsyncStorage.setItem);
  const removeItem = jest.mocked(AsyncStorage.removeItem);
  function Harness({ userId }: { userId: string }) {
    current = useReportDraft(userId);
    return null;
  }
  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  beforeEach(() => {
    jest.clearAllMocks();
    getItem.mockResolvedValue(null);
    setItem.mockResolvedValue();
    removeItem.mockResolvedValue();
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
  });

  it('does not overwrite a draft before async restoration completes', async () => {
    let restore!: (value: string) => void;
    getItem.mockReturnValueOnce(
      new Promise((resolve) => {
        restore = resolve;
      }),
    );
    await act(async () => {
      root.render(<Harness userId="alice" />);
    });
    expect(current.ready).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    await act(async () => {
      restore(JSON.stringify(savedDraft));
    });
    expect(current.draft).toEqual(savedDraft);
    expect(current.restored).toBe(true);
  });

  it('keeps a failed-save draft in memory and clears it after completion without re-saving', async () => {
    await act(async () => {
      root.render(<Harness userId="alice" />);
    });
    setItem.mockRejectedValueOnce(new Error('Disk full'));
    await act(async () => {
      current.setDraft(savedDraft);
    });
    expect(current.saveStatus).toBe('error');
    expect(current.draft).toEqual(savedDraft);
    await act(async () => {
      await current.clear(true);
    });
    expect(current.draft).toEqual(emptyReportDraft());
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenLastCalledWith('guardians:report-draft:v1:alice');
  });

  it('keeps the draft when discard fails, and resumes saving after a successful discard', async () => {
    getItem.mockResolvedValueOnce(JSON.stringify(savedDraft));
    await act(async () => {
      root.render(<Harness userId="alice" />);
    });
    removeItem.mockRejectedValueOnce(new Error('Unavailable'));
    await act(async () => {
      await expect(current.clear()).rejects.toThrow('Unavailable');
    });
    expect(current.draft).toEqual(savedDraft);
    await act(async () => {
      await current.clear();
    });
    await act(async () => {
      current.setDraft({ ...savedDraft, title: 'New cat' });
    });
    expect(current.saveStatus).toBe('saved');
    expect(setItem).toHaveBeenLastCalledWith(
      'guardians:report-draft:v1:alice',
      expect.stringContaining('New cat'),
    );
  });

  it('ignores a stale restoration when switching keyed account forms', async () => {
    let restoreAlice!: (value: string) => void;
    getItem.mockReturnValueOnce(
      new Promise((resolve) => {
        restoreAlice = resolve;
      }),
    );
    await act(async () => {
      root.render(<Harness key="alice" userId="alice" />);
    });
    await act(async () => {
      root.render(<Harness key="bob" userId="bob" />);
    });
    await act(async () => {
      restoreAlice(JSON.stringify(savedDraft));
    });
    expect(current.draft).toEqual(emptyReportDraft());
    expect(setItem).not.toHaveBeenCalled();
  });
});
