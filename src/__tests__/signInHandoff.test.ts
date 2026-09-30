import { clearHandedOffEmail, handOffEmail, peekHandedOffEmail } from '@/lib/signInHandoff';

afterEach(clearHandedOffEmail);

test('starts empty', () => {
  expect(peekHandedOffEmail()).toBe('');
});

test('hands an email from one screen to the next', () => {
  handOffEmail('cat.lover@example.com');
  expect(peekHandedOffEmail()).toBe('cat.lover@example.com');
});

test('reading it does not consume it, so a double render still sees it', () => {
  handOffEmail('cat.lover@example.com');
  peekHandedOffEmail();
  expect(peekHandedOffEmail()).toBe('cat.lover@example.com');
});

test('is forgotten once cleared', () => {
  handOffEmail('cat.lover@example.com');
  clearHandedOffEmail();
  expect(peekHandedOffEmail()).toBe('');
});
