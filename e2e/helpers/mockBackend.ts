import type { Page } from '@playwright/test';
import { Buffer } from 'buffer';

/**
 * Core-loop flows (report -> claim -> rescue) run against a mocked Supabase, so
 * they exercise the real screens, hooks and RPC wrappers without touching a
 * backend. The Supabase URL matches playwright.config.ts.
 */
const API = 'https://release-test.supabase.co/**';
export const ME = '00000000-0000-4000-8000-000000000001';
export const OTHER = '00000000-0000-4000-8000-000000000002';
export const SIGHTING_ID = '11111111-1111-4111-8111-111111111111';
export const DHAKA = { latitude: 23.8103, longitude: 90.4125 };
export const BLOCKED = '00000000-0000-4000-8000-000000000003';
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const USER = {
  id: ME,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'flow-test@example.test',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

export const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export function sighting(overrides: Record<string, unknown> = {}) {
  return {
    id: SIGHTING_ID,
    reporter_id: OTHER,
    title: 'Orange tabby by the park',
    description: null,
    lat: DHAKA.latitude,
    lng: DHAKA.longitude,
    address: null,
    status: 'spotted',
    temperament: 'unknown',
    color: null,
    is_injured: false,
    needs_urgent_help: false,
    claimed_by: null,
    claimed_at: null,
    rescued_at: null,
    created_at: hoursAgo(48),
    updated_at: hoursAgo(48),
    is_precise: false,
    reporter: { id: OTHER, username: 'Reporter', avatar_url: null, level: 1 },
    claimer: null,
    photos: [],
    ...overrides,
  };
}

export interface Call {
  fn: string;
  body: Record<string, unknown>;
}

type RpcHandler = (body: Record<string, unknown>) => {
  status?: number;
  json: unknown;
  /** Hold the response back, to observe what the UI shows while it waits. */
  delayMs?: number;
};

type Sighting = ReturnType<typeof sighting>;

export async function signIn(
  page: Page,
  options: {
    sighting?: Sighting | (() => Sighting);
    rpc?: Record<string, RpcHandler>;
    blocks?: unknown[];
    /** Reads of a table, keyed by table name (e.g. adoption_interest). */
    tables?: Record<string, () => unknown>;
  } = {},
) {
  const calls: Call[] = [];
  await page.route(API, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.includes('/rpc/')) {
      const fn = path.split('/rpc/')[1];
      let body: Record<string, unknown> = {};
      try {
        body = request.postDataJSON() ?? {};
      } catch {
        // RPCs without a JSON body (or preflights) carry nothing to record.
      }
      if (request.method() === 'POST') calls.push({ fn, body });
      const custom = options.rpc?.[fn];
      if (custom) {
        const { status = 200, json, delayMs = 0 } = custom(body);
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return route.fulfill({ status, json });
      }
      if (fn === 'get_sighting_detail' && options.sighting) {
        const current =
          typeof options.sighting === 'function' ? options.sighting() : options.sighting;
        return route.fulfill({ json: current });
      }
      return route.fulfill({ json: fn === 'is_moderator' ? false : [] });
    }
    if (path.endsWith('/auth/v1/user')) return route.fulfill({ json: USER });
    if (path.endsWith('/user_blocks')) return route.fulfill({ json: options.blocks ?? [] });
    const table = path.split('/rest/v1/')[1];
    if (table && options.tables?.[table] && request.method() === 'GET') {
      return route.fulfill({ json: options.tables[table]() });
    }
    // Signed links to private files (ID photos): sign, then serve an image.
    if (path.includes('/storage/v1/object/sign/')) {
      if (request.method() === 'POST') {
        const bucket = path.split('/storage/v1/object/sign/')[1];
        const { paths = [] } = (request.postDataJSON() ?? {}) as { paths?: string[] };
        calls.push({ fn: 'storage.sign', body: { bucket, paths } });
        return route.fulfill({
          json: paths.map((p) => ({
            path: p,
            signedURL: `/object/sign/${bucket}/${p}?token=test`,
            error: null,
          })),
        });
      }
      return route.fulfill({ contentType: 'image/png', body: PNG_1X1 });
    }
    if (path.includes('/storage/v1/object/')) {
      return route.fulfill({ json: { Key: path.split('/storage/v1/object/')[1] } });
    }
    if (path.endsWith('/sighting_photos') && route.request().method() === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        body = route.request().postDataJSON() ?? {};
      } catch {
        // Nothing to record.
      }
      calls.push({ fn: 'sighting_photos.insert', body });
      return route.fulfill({
        status: 201,
        json: { id: 'photo-1', created_at: hoursAgo(0), ...body },
      });
    }
    if (path.endsWith('/profiles')) {
      return route.fulfill({
        json: { ...USER, username: 'Flow tester', points: 0, level: 1, is_guardian: true },
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.addInitScript((user) => {
    localStorage.setItem(
      'sb-release-test-auth-token',
      JSON.stringify({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      }),
    );
    localStorage.setItem('@guardians/primer_location', '1');
    localStorage.setItem(`@guardians/primer_notifications/${user.id}`, '1');
  }, USER);
  return { calls };
}
