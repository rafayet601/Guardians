import { uploadImage } from '@/api/storage';
const mockUpload = jest.fn(async () => ({ error: null }));
const mockResize = jest.fn();
const mockRelease = jest.fn();
const mockSave = jest.fn(async () => ({ base64: 'aW1hZ2U=' }));
const mockOriginal = { width: 4000, height: 3000, saveAsync: mockSave, release: mockRelease };
const mockImage = { saveAsync: mockSave, release: mockRelease };
const mockContext = { renderAsync: jest.fn(async () => mockOriginal), release: mockRelease };
const mockResized = {
  resize: mockResize,
  renderAsync: jest.fn(async () => mockImage),
  release: mockRelease,
};
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (source: unknown) => (typeof source === 'string' ? mockContext : mockResized),
  },
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
      }),
    },
  },
}));
beforeEach(() => jest.clearAllMocks());
test('photos preserve aspect ratio, normalize HEIC input to JPEG and release native resources', async () => {
  const url = await uploadImage('cat-photos', 'owner', {
    uri: 'file:///photo.heic',
    mimeType: 'image/heic',
  });
  expect(mockResize).toHaveBeenCalledWith({ width: 1600, height: 1200 });
  expect(mockUpload).toHaveBeenCalledWith(
    expect.stringMatching(/^owner\/.*\.jpg$/),
    expect.anything(),
    { contentType: 'image/jpeg', upsert: false },
  );
  expect(url).toMatch(/\.jpg$/);
  expect(mockRelease).toHaveBeenCalledTimes(4);
});
test('avatars are capped at 512 pixels', async () => {
  await uploadImage('avatars', 'owner', { uri: 'file:///photo.jpg' });
  expect(mockResize).toHaveBeenCalledWith({ width: 512, height: 384 });
});
