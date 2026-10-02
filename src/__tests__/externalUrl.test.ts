import { URL as NodeURL } from 'node:url';

import { externalWebUrl } from '@/lib/externalUrl';

beforeAll(() => {
  Object.defineProperty(globalThis, 'URL', { value: NodeURL, configurable: true });
});

test.each([
  'javascript:alert(document.cookie)',
  'data:text/html,<script>alert(1)</script>',
  'intent://settings',
  'guardians://reset?access_token=attacker',
  'file:///etc/passwd',
  '//attacker.example',
  'https://trusted.example@attacker.example',
  'https://user:password@example.com',
  'java\nscript:alert(1)',
  '\thttps://example.com',
  '/relative',
  '',
  null,
])('rejects unsafe sponsored link %s', (url) => {
  expect(externalWebUrl(url)).toBeNull();
});

test('preserves ordinary web links and their campaign parameters', () => {
  expect(externalWebUrl('https://example.com/rewards?campaign=guardians#offer')).toBe(
    'https://example.com/rewards?campaign=guardians#offer',
  );
  expect(externalWebUrl('http://example.com')).toBe('http://example.com/');
});
