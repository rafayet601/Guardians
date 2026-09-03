/**
 * @jest-environment jsdom
 *
 * Marker lifecycle tests for the web map shim.
 *
 * These cover the logic that is hardest to eyeball in a browser and easiest to
 * regress: the marker must be created ONCE and then moved, not torn down and
 * rebuilt whenever `coordinate` changes — otherwise the controlled write-back
 * at the end of a drag (onDragEnd → setState → new coordinate) would destroy
 * the pin under the user's cursor. It also pins the drag event shape, since
 * report.tsx reads `e.nativeEvent.coordinate`.
 *
 * This is a DOM component (it renders a <div>), so it is driven with
 * react-dom/client rather than react-native-testing-library.
 *
 * Rendered marker DOM, for reference:
 *   div.guardians-marker.leaflet-marker-icon   ← Leaflet's icon element
 *     └ div                                    ← the host node the shim owns
 *        └ div[style*=transform]               ← the portal wrapper (anchor + cursor)
 *           └ children / DefaultPin
 */
import L from 'leaflet';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { MapView, Marker } from '@/components/PlatformMap.web';

// jsdom has no ResizeObserver; MapView observes its container for re-measures.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const SF = { latitude: 37.7749, longitude: -122.4194 };
const REGION = { ...SF, latitudeDelta: 0.05, longitudeDelta: 0.05 };

const MARKER = '.guardians-marker';
/** The portal wrapper that carries the anchor transform and cursor. */
const WRAPPER = '.guardians-marker > div > div';

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = NoopResizeObserver;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.restoreAllMocks();
});

function renderMap(children: ReactNode) {
  act(() => {
    root.render(<MapView initialRegion={REGION}>{children}</MapView>);
  });
}

const wrapperEl = () => document.querySelector(WRAPPER) as HTMLElement;

describe('web Marker', () => {
  it('creates exactly one Leaflet marker inside one map', () => {
    renderMap(<Marker coordinate={SF} />);
    expect(document.querySelectorAll('.leaflet-container')).toHaveLength(1);
    expect(document.querySelectorAll(MARKER)).toHaveLength(1);
  });

  it('MOVES the marker on coordinate change instead of recreating it', () => {
    const spy = jest.spyOn(L, 'marker');
    renderMap(<Marker coordinate={SF} />);
    const first = document.querySelector(MARKER);
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(
        <MapView initialRegion={REGION}>
          <Marker coordinate={{ latitude: 40.7128, longitude: -74.006 }} />
        </MapView>,
      );
    });

    // Same DOM node and no second L.marker() call => repositioned, not rebuilt.
    // This is the regression that would break dragging.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(MARKER)).toHaveLength(1);
    expect(document.querySelector(MARKER)).toBe(first);
  });

  it('actually applies the new position to the Leaflet marker', () => {
    const spy = jest.spyOn(L, 'marker');
    renderMap(<Marker coordinate={SF} />);
    const marker = spy.mock.results[0].value as L.Marker;

    act(() => {
      root.render(
        <MapView initialRegion={REGION}>
          <Marker coordinate={{ latitude: 40.7128, longitude: -74.006 }} />
        </MapView>,
      );
    });

    expect(marker.getLatLng().lat).toBeCloseTo(40.7128, 4);
    expect(marker.getLatLng().lng).toBeCloseTo(-74.006, 4);
  });

  it('renders children into the marker node (how MapPin/ClusterBubble work)', () => {
    renderMap(
      <Marker coordinate={SF}>
        <span>orange tabby</span>
      </Marker>,
    );
    expect(document.querySelector(MARKER)?.textContent).toContain('orange tabby');
  });

  it('applies the react-native-maps fractional anchor as a transform', () => {
    renderMap(<Marker coordinate={SF} anchor={{ x: 0.5, y: 0.5 }} />);
    expect(wrapperEl().style.transform).toBe('translate(-50%, -50%)');
  });

  it('defaults the anchor to a pin tip (bottom-centre)', () => {
    renderMap(<Marker coordinate={SF} />);
    expect(wrapperEl().style.transform).toBe('translate(-50%, -100%)');
  });

  it('removes the marker when unmounted', () => {
    renderMap(<Marker coordinate={SF} />);
    expect(document.querySelectorAll(MARKER)).toHaveLength(1);
    act(() => {
      root.render(<MapView initialRegion={REGION} />);
    });
    expect(document.querySelectorAll(MARKER)).toHaveLength(0);
  });
});

describe('web Marker — dragging (stage 2)', () => {
  it('is not draggable by default', () => {
    renderMap(<Marker coordinate={SF} />);
    expect(document.querySelector(MARKER)?.className).not.toContain('leaflet-marker-draggable');
    expect(wrapperEl().style.cursor).toBe('default');
  });

  it('enables Leaflet dragging and shows a grab cursor when draggable', () => {
    renderMap(<Marker coordinate={SF} draggable />);
    expect(document.querySelector(MARKER)?.className).toContain('leaflet-marker-draggable');
    expect(wrapperEl().style.cursor).toBe('grab');
  });

  it('toggles dragging off again when the prop flips', () => {
    renderMap(<Marker coordinate={SF} draggable />);
    expect(document.querySelector(MARKER)?.className).toContain('leaflet-marker-draggable');

    act(() => {
      root.render(
        <MapView initialRegion={REGION}>
          <Marker coordinate={SF} draggable={false} />
        </MapView>,
      );
    });
    expect(document.querySelector(MARKER)?.className).not.toContain('leaflet-marker-draggable');
  });

  it('emits the react-native-maps event shape on dragend', () => {
    const spy = jest.spyOn(L, 'marker');
    const onDragEnd = jest.fn();
    renderMap(<Marker coordinate={SF} draggable onDragEnd={onDragEnd} />);
    const marker = spy.mock.results[0].value as L.Marker;

    act(() => {
      marker.setLatLng([40, -70]); // what a real drag leaves behind
      marker.fire('dragend');
    });

    expect(onDragEnd).toHaveBeenCalledTimes(1);
    // report.tsx destructures e.nativeEvent.coordinate — this is the contract.
    expect(onDragEnd.mock.calls[0][0]).toEqual({
      nativeEvent: { coordinate: { latitude: 40, longitude: -70 } },
    });
  });

  it('emits dragstart and drag as well', () => {
    const spy = jest.spyOn(L, 'marker');
    const onDragStart = jest.fn();
    const onDrag = jest.fn();
    renderMap(<Marker coordinate={SF} draggable onDragStart={onDragStart} onDrag={onDrag} />);
    const marker = spy.mock.results[0].value as L.Marker;

    act(() => {
      marker.fire('dragstart');
      marker.fire('drag');
    });

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onDrag.mock.calls[0][0].nativeEvent.coordinate.latitude).toBeCloseTo(SF.latitude, 4);
  });

  it('calls the latest onDragEnd after a re-render, not a stale closure', () => {
    const spy = jest.spyOn(L, 'marker');
    const first = jest.fn();
    const second = jest.fn();
    renderMap(<Marker coordinate={SF} draggable onDragEnd={first} />);
    const marker = spy.mock.results[0].value as L.Marker;

    act(() => {
      root.render(
        <MapView initialRegion={REGION}>
          <Marker coordinate={SF} draggable onDragEnd={second} />
        </MapView>,
      );
    });
    act(() => marker.fire('dragend'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
