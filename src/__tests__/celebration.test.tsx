import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Celebration } from '@/components/Celebration';

let mockReducedMotion = false;
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const animation = { duration: () => ({}) };
  return {
    __esModule: true,
    default: { View },
    FadeIn: animation,
    FadeOut: animation,
    useReducedMotion: () => mockReducedMotion,
  };
});
jest.mock('@/components/RewardBurst', () => ({
  RewardBurst: () => require('react').createElement('Burst'),
}));
jest.mock('@/components/ui', () => ({
  Text: ({ children }: { children: string }) =>
    require('react').createElement(require('react-native').Text, null, children),
}));

const moment = { title: 'Rescue complete', message: 'Thank you.' };
let tree: ReactTestRenderer | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  mockReducedMotion = false;
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

const render = (props: Parameters<typeof Celebration>[0]) =>
  act(async () => {
    if (tree) tree.update(<Celebration {...props} />);
    else tree = create(<Celebration {...props} />);
  });

test('renders nothing when there is nothing to celebrate', async () => {
  await render({ celebration: null, onDone: jest.fn() });
  expect(tree!.toJSON()).toBeNull();
});

test('shows the moment, announces it, and never intercepts touches', async () => {
  await render({ celebration: moment, onDone: jest.fn() });
  const root = tree!.root.findByProps({ accessibilityLiveRegion: 'polite' });
  expect(root.props.accessibilityLabel).toBe('Rescue complete. Thank you.');
  expect(root.props.pointerEvents).toBe('none');
});

test('dismisses itself after the duration', async () => {
  const onDone = jest.fn();
  await render({ celebration: moment, onDone, durationMs: 3000 });
  await act(async () => jest.advanceTimersByTimeAsync(2999));
  expect(onDone).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('does not fire after it has been replaced or removed', async () => {
  const onDone = jest.fn();
  await render({ celebration: moment, onDone, durationMs: 3000 });
  await render({ celebration: null, onDone, durationMs: 3000 });
  await act(async () => jest.advanceTimersByTimeAsync(10_000));
  expect(onDone).not.toHaveBeenCalled();
});

test('plays the confetti unless reduced motion is on, and still shows the message either way', async () => {
  await render({ celebration: moment, onDone: jest.fn() });
  expect(tree!.root.findAllByType('Burst' as never)).toHaveLength(1);
  await act(async () => tree?.unmount());
  tree = undefined;

  mockReducedMotion = true;
  await render({ celebration: moment, onDone: jest.fn() });
  expect(tree!.root.findAllByType('Burst' as never)).toHaveLength(0);
  expect(
    tree!.root.findByProps({ accessibilityLiveRegion: 'polite' }).props.accessibilityLabel,
  ).toBe('Rescue complete. Thank you.');
});

test('re-rendering with a new callback does not restart the timer', async () => {
  const first = jest.fn();
  const second = jest.fn();
  await render({ celebration: moment, onDone: first, durationMs: 3000 });
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  await render({ celebration: moment, onDone: second, durationMs: 3000 });
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});
