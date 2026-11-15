import { Buffer } from 'buffer';

import { MAX_SCREENING_DOC_BYTES, uploadScreeningDoc } from '@/api/screening';

const mockUpload = jest.fn(async (): Promise<{ error: Error | null }> => ({ error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ upload: mockUpload }) } },
}));

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
beforeEach(() => jest.clearAllMocks());

test.each([
  ['image/jpeg', 'jpg', jpeg],
  ['image/png', 'png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ['image/webp', 'webp', Buffer.from('RIFF0000WEBP')],
  ['image/heic', 'heic', Buffer.from('0000ftypheic')],
  ['image/heif', 'heif', Buffer.from('0000ftypmif1')],
] as const)(
  'uploads supported %s ID photos privately with the matching suffix',
  async (mime, ext, bytes) => {
    const path = await uploadScreeningDoc('synthetic-owner', {
      uri: 'file://synthetic-id',
      mimeType: mime,
      base64: bytes.toString('base64'),
    });
    expect(path).toMatch(new RegExp(`^synthetic-owner/.*\\.${ext}$`));
    expect(mockUpload).toHaveBeenCalledWith(path, bytes, { contentType: mime, upsert: false });
  },
);

test('uses the JPEG payload type when ImagePicker reports the original HEIC type', async () => {
  const path = await uploadScreeningDoc('synthetic-owner', {
    uri: 'file://synthetic-id.heic',
    mimeType: 'image/heic',
    base64: jpeg.toString('base64'),
  });
  expect(path).toMatch(/\.jpg$/);
  expect(mockUpload).toHaveBeenCalledWith(path, jpeg, { contentType: 'image/jpeg', upsert: false });
});

test.each(['image/svg+xml', 'text/html', 'application/pdf', 'image/gif', 'toString'])(
  'rejects unsupported %s declarations before upload',
  async (mimeType) => {
    await expect(
      uploadScreeningDoc('synthetic-owner', {
        uri: 'file://synthetic-id',
        mimeType,
        base64: jpeg.toString('base64'),
      }),
    ).rejects.toThrow('Please choose a JPEG');
    expect(mockUpload).not.toHaveBeenCalled();
  },
);

test.each([null, '', '!!!!', 'a===', Buffer.from('<svg></svg>').toString('base64')])(
  'rejects missing, malformed or unrecognized image data before upload',
  async (base64) => {
    await expect(
      uploadScreeningDoc('synthetic-owner', { uri: 'file://synthetic-id', base64 }),
    ).rejects.toThrow();
    expect(mockUpload).not.toHaveBeenCalled();
  },
);

test('enforces the decoded 10 MiB boundary, including a payload with the same encoded length', async () => {
  const bytes = Buffer.alloc(MAX_SCREENING_DOC_BYTES);
  jpeg.copy(bytes);
  await uploadScreeningDoc('synthetic-owner', {
    uri: 'file://synthetic-id',
    base64: bytes.toString('base64'),
  });
  expect(mockUpload).toHaveBeenCalledTimes(1);
  mockUpload.mockClear();
  await expect(
    uploadScreeningDoc('synthetic-owner', {
      uri: 'file://synthetic-id',
      base64: Buffer.concat([bytes, Buffer.from([0])]).toString('base64'),
    }),
  ).rejects.toThrow('no larger than 10 MiB');
  expect(mockUpload).not.toHaveBeenCalled();
});

test('storage failures remain visible without returning a document path', async () => {
  mockUpload.mockResolvedValueOnce({ error: new Error('Upload unavailable') });
  await expect(
    uploadScreeningDoc('synthetic-owner', {
      uri: 'file://synthetic-id',
      base64: jpeg.toString('base64'),
    }),
  ).rejects.toThrow('Upload unavailable');
});
