import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'buffer';

/**
 * Core-loop flows (report -> claim -> rescue) run against a mocked Supabase, so
 * they exercise the real screens, hooks and RPC wrappers without touching a
 * backend. The Supabase URL matches playwright.config.ts.
 */
const API = 'https://release-test.supabase.co/**';
const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const SIGHTING_ID = '11111111-1111-4111-8111-111111111111';
const DHAKA = { latitude: 23.8103, longitude: 90.4125 };
const BLOCKED = '00000000-0000-4000-8000-000000000003';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const USER = {
  id: ME,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'flow-test@example.test',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

function sighting(overrides: Record<string, unknown> = {}) {
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

interface Call {
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

async function signIn(
  page: Page,
  options: {
    sighting?: Sighting | (() => Sighting);
    rpc?: Record<string, RpcHandler>;
    blocks?: unknown[];
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

/** Accept every native dialog (window.confirm / alert) and remember what it said. */
function acceptDialogs(page: Page) {
  const messages: string[] = [];
  page.on('dialog', (dialog) => {
    messages.push(dialog.message());
    void dialog.accept();
  });
  return messages;
}

const rpcCalls = (calls: Call[], fn: string) => calls.filter((c) => c.fn === fn);

/**
 * Where the first pin sits inside the map viewport, or null while there is no
 * pin. The shim wraps every marker in a zero-size Leaflet node, so its position
 * is read from geometry rather than asserted with toBeVisible().
 */
const pinInViewport = (page: Page) =>
  page.evaluate(() => {
    const marker = document.querySelector('.leaflet-marker-icon');
    const container = document.querySelector('.leaflet-container');
    if (!marker || !container) return null;
    const m = marker.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    return m.x >= c.x && m.x <= c.x + c.width && m.y >= c.y && m.y <= c.y + c.height;
  });

test.describe('rescue lifecycle', () => {
  test('the assigned Guardian can get directions and release a claim they cannot fulfil', async ({
    page,
  }) => {
    let current = sighting({
      status: 'claimed',
      claimed_by: ME,
      claimed_at: hoursAgo(2),
      updated_at: hoursAgo(2),
      is_precise: true,
      claimer: { id: ME, username: 'Flow tester', avatar_url: null, level: 1 },
    });
    const { calls } = await signIn(page, {
      sighting: () => current,
      rpc: {
        // Mirrors update_sighting_status: releasing clears the Guardian, and the
        // ex-Guardian loses the exact location.
        update_sighting_status: (body) => {
          current = {
            ...current,
            status: String(body.p_new_status),
            claimed_by: null,
            claimed_at: null,
            is_precise: false,
            claimer: null,
          };
          return { json: current };
        },
      },
    });
    const dialogs = acceptDialogs(page);

    await page.goto(`/sighting/${SIGHTING_ID}`);
    await expect(page.getByText('You are the assigned guardian')).toBeVisible();
    await expect(page.getByRole('button', { name: /Get directions/ })).toBeVisible();
    await expect(page.getByText(/Exact location/)).toBeVisible();

    await page.getByRole('button', { name: "Release — I can't do this" }).click();
    await expect.poll(() => rpcCalls(calls, 'update_sighting_status').length).toBe(1);

    const [call] = rpcCalls(calls, 'update_sighting_status');
    expect(call.body).toMatchObject({ p_sighting: SIGHTING_ID, p_new_status: 'spotted' });
    expect(String(call.body.p_note)).toMatch(/released/i);
    expect(dialogs[0]).toContain('Release this rescue?');
    // The screen re-reads the cat and shows it back on the map, unclaimed, with
    // the exact location withdrawn from the person who released it.
    await expect(page.getByText('No guardian assigned')).toBeVisible();
    await expect(page.getByRole('button', { name: /Claim this rescue/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Get directions/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: "Release — I can't do this" })).toHaveCount(0);
  });

  test('people who cannot see the exact location are never offered directions', async ({
    page,
  }) => {
    await signIn(page, { sighting: sighting({ is_precise: false }) });
    await page.goto(`/sighting/${SIGHTING_ID}`);
    await expect(page.getByText(/Approximate area/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Get directions/ })).toHaveCount(0);
  });

  test('losing a claim race explains it kindly and refreshes the screen', async ({ page }) => {
    const { calls } = await signIn(page, {
      sighting: sighting({ needs_urgent_help: true }),
      rpc: {
        claim_sighting: () => ({
          status: 400,
          json: { code: 'P0001', message: 'This cat is no longer available to claim' },
        }),
      },
    });
    const dialogs = acceptDialogs(page);

    await page.goto(`/sighting/${SIGHTING_ID}`);
    await page.getByRole('button', { name: /Claim this rescue/ }).click();

    await expect.poll(() => dialogs.length).toBeGreaterThanOrEqual(2);
    expect(dialogs[0]).toContain('Claim this rescue?');
    expect(dialogs[0]).toContain('release it from this screen');
    expect(dialogs[1]).toContain('Another Guardian got there first');
    expect(dialogs[1]).not.toContain('no longer available to claim');
    await expect.poll(() => rpcCalls(calls, 'get_sighting_detail').length).toBeGreaterThan(1);
  });

  test('a reporter sees their report is live, not a claim promo, and can close it', async ({
    page,
  }) => {
    const { calls } = await signIn(page, {
      sighting: sighting({
        reporter_id: ME,
        reporter: { id: ME, username: 'Flow tester', avatar_url: null, level: 1 },
        needs_urgent_help: true,
        is_precise: true,
      }),
    });
    const dialogs = acceptDialogs(page);

    await page.goto(`/sighting/${SIGHTING_ID}`);
    await expect(page.getByText('Your report is live', { exact: true })).toBeVisible();
    await expect(page.getByText(/Earn \d+ points/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Claim this rescue/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /rescue this cat myself/ })).toBeVisible();

    await page.getByRole('button', { name: 'Close report' }).click();
    await expect.poll(() => rpcCalls(calls, 'update_sighting_status').length).toBe(1);
    expect(rpcCalls(calls, 'update_sighting_status')[0].body).toMatchObject({
      p_new_status: 'archived',
    });
    expect(dialogs[0]).toContain('found, has moved on, or was reported by mistake');
  });

  test('the reporter can only reopen a claimed cat once the Guardian has gone quiet', async ({
    page,
  }) => {
    const claimedBy = { id: OTHER, username: 'Slow guardian', avatar_url: null, level: 1 };
    const claimed = (hours: number) =>
      sighting({
        reporter_id: ME,
        reporter: { id: ME, username: 'Flow tester', avatar_url: null, level: 1 },
        status: 'claimed',
        claimed_by: OTHER,
        claimed_at: hoursAgo(hours),
        updated_at: hoursAgo(hours),
        claimer: claimedBy,
      });

    await signIn(page, { sighting: claimed(3) });
    await page.goto(`/sighting/${SIGHTING_ID}`);
    await expect(page.getByText('Slow guardian is assigned')).toBeVisible();
    await expect(page.getByRole('button', { name: /Reopen/ })).toHaveCount(0);

    await page.unrouteAll();
    await signIn(page, { sighting: claimed(30) });
    await page.reload();
    await expect(
      page.getByRole('button', { name: /Guardian not responding\? Reopen/ }),
    ).toBeVisible();
    await expect(page.getByText(/has not posted for over a day/)).toBeVisible();
  });
});

test.describe('reporting a cat', () => {
  test.use({ geolocation: DHAKA, permissions: ['geolocation'] });

  test('the pin starts where the reporter is and the map is looking at it', async ({ page }) => {
    await signIn(page);
    await page.goto('/report');

    // The pin used to be placed where the camera was not looking (the default
    // city), so the reporter saw an empty map and tapped the wrong place.
    await expect.poll(() => pinInViewport(page), { timeout: 20_000 }).toBe(true);
  });

  test('an injured cat is posted as urgent so nearby Guardians are alerted', async ({ page }) => {
    const { calls } = await signIn(page, {
      sighting: sighting({ reporter_id: ME, is_injured: true, needs_urgent_help: true }),
      rpc: {
        create_sighting: () => ({
          json: sighting({ reporter_id: ME, is_injured: true, needs_urgent_help: true }),
        }),
      },
    });
    await page.goto('/report');
    await expect.poll(() => pinInViewport(page), { timeout: 20_000 }).toBe(true);

    // react-native-web renders each Switch as a wrapper plus a hidden checkbox
    // input; state is read from the input, the click goes to the wrapper.
    const urgent = page.locator('input[role="switch"][aria-label*="Needs urgent help"]');
    await expect(urgent).not.toBeChecked();
    await page
      .getByRole('switch', { name: /looks injured/ })
      .first()
      .click();
    await expect(urgent).toBeChecked();
    await expect(urgent).toBeDisabled();
    await expect(page.getByText('Injured cats are marked urgent automatically.')).toBeVisible();

    await page.getByRole('button', { name: 'Post sighting' }).click();
    await expect.poll(() => rpcCalls(calls, 'create_sighting').length).toBe(1);
    expect(rpcCalls(calls, 'create_sighting')[0].body).toMatchObject({
      p_is_injured: true,
      p_needs_urgent_help: true,
    });
    await expect(page).toHaveURL(new RegExp(`/sighting/${SIGHTING_ID}$`));
  });

  test('offers safety guidance and a way to find the spot without GPS', async ({ page }) => {
    await signIn(page);
    await page.goto('/report');
    await expect(page.getByText('Stay safe while you report')).toBeVisible();
    await expect(page.getByLabel('Search for an address')).toBeVisible();
    await expect(page.getByText(/You can post without one/)).toBeVisible();
  });
});

test.describe('adding photos to a report', () => {
  test('the Guardian can add a photo to a report that already exists', async ({ page }) => {
    const { calls } = await signIn(page, {
      sighting: sighting({
        status: 'safe',
        claimed_by: ME,
        claimed_at: hoursAgo(5),
        is_precise: true,
        claimer: { id: ME, username: 'Flow tester', avatar_url: null, level: 1 },
      }),
    });
    await page.goto(`/sighting/${SIGHTING_ID}`);
    await expect(page.getByText('A clear photo of the cat in care helps adopters.')).toBeVisible();

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: /Add a photo/ }).click(),
    ]);
    await chooser.setFiles({ name: 'cat.png', mimeType: 'image/png', buffer: PNG_1X1 });

    await expect.poll(() => rpcCalls(calls, 'sighting_photos.insert').length).toBe(1);
    const [insert] = rpcCalls(calls, 'sighting_photos.insert');
    expect(insert.body).toMatchObject({ sighting_id: SIGHTING_ID, uploaded_by: ME });
    expect(String(insert.body.url)).toContain('/cat-photos/');
  });

  test('a stranger is never offered the add-photo action', async ({ page }) => {
    await signIn(page, { sighting: sighting() });
    await page.goto(`/sighting/${SIGHTING_ID}`);
    await expect(page.getByRole('button', { name: /Claim this rescue/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Add a photo/ })).toHaveCount(0);
  });
});

test.describe('the map and the nearby list', () => {
  test.use({ geolocation: DHAKA, permissions: ['geolocation'] });

  const cat = (id: string, title: string, overrides: Record<string, unknown> = {}) => ({
    id,
    lat: DHAKA.latitude,
    lng: DHAKA.longitude,
    title,
    status: 'spotted',
    temperament: 'unknown',
    color: null,
    is_injured: false,
    needs_urgent_help: false,
    created_at: hoursAgo(3),
    distance_m: 100,
    reporter_id: OTHER,
    reporter_username: 'Reporter',
    thumbnail_url: null,
    ...overrides,
  });

  const nearby = [
    // Resolved cats close by, one still carrying the (never cleared) urgent flag.
    cat('c-safe', 'Charlie safe cat', { status: 'safe', needs_urgent_help: true, distance_m: 50 }),
    cat('b-claimed', 'Bravo claimed cat', {
      status: 'claimed',
      needs_urgent_help: true,
      distance_m: 120,
    }),
    // The one that actually needs someone, ~3 km away.
    cat('a-open', 'Alpha open cat', {
      needs_urgent_help: true,
      lat: DHAKA.latitude + 0.027,
      distance_m: 3005,
    }),
    cat('d-blocked', 'Delta blocked cat', { reporter_id: BLOCKED, distance_m: 30 }),
  ];

  test('lists what needs a Guardian first, keeps the alarm for open cats, and honours blocks', async ({
    page,
  }) => {
    await signIn(page, {
      rpc: { nearby_sightings: () => ({ json: nearby }) },
      blocks: [
        {
          blocked_id: BLOCKED,
          created_at: hoursAgo(1),
          blocked: { id: BLOCKED, username: 'Blocked', full_name: null, avatar_url: null },
        },
      ],
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Expand nearby sightings list' }).click();
    await expect(page.getByText('Alpha open cat')).toBeVisible();

    // A blocked user's report is gone, as the block dialog promises.
    await expect(page.getByText('Delta blocked cat')).toHaveCount(0);

    // Most actionable first, even though the resolved cats are much nearer.
    const text = await page.locator('body').innerText();
    expect(text.indexOf('Alpha open cat')).toBeGreaterThan(-1);
    expect(text.indexOf('Alpha open cat')).toBeLessThan(text.indexOf('Bravo claimed cat'));
    expect(text.indexOf('Bravo claimed cat')).toBeLessThan(text.indexOf('Charlie safe cat'));

    // Only the cat still waiting for a Guardian is flagged urgent.
    await expect(page.getByLabel('Urgent', { exact: true })).toHaveCount(1);

    // "X away" is from the person, not the map centre: ~3.0 km to the open cat.
    await expect(page.getByText('3.0 km away')).toBeVisible();
    // The filter names what it does.
    await expect(page.getByRole('button', { name: 'Filter: 🆘 Needs a Guardian' })).toBeVisible();
    // With location on there is nothing to nudge about.
    await expect(page.getByText('Turn on location to see cats near you')).toHaveCount(0);
  });

  test('pans without blanking the list', async ({ page }) => {
    let calls = 0;
    await signIn(page, {
      rpc: {
        nearby_sightings: () => {
          calls += 1;
          // Only the first read is instant; later ones are slow enough to see
          // what the screen shows while it waits for the new area.
          return { json: nearby, delayMs: calls > 1 ? 2500 : 0 };
        },
      },
    });
    await page.goto('/');
    await expect(page.getByText('Alpha open cat')).toBeVisible();
    const before = calls;

    // Pan the map itself (the sheet sits at its peek height, so the upper part
    // of the screen is map). A pan is a new query key.
    const box = await page.locator('.leaflet-container').first().boundingBox();
    const y = box!.y + box!.height * 0.4;
    await page.mouse.move(box!.x + box!.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 160, y + 40, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => calls).toBeGreaterThan(before);
    // While the slow answer is in flight the previous cats stay put, and the
    // full-list spinner never replaces them.
    await expect(page.getByText('Updating…')).toBeVisible();
    await expect(page.getByText('Alpha open cat')).toBeVisible();
    await expect(page.getByText('Finding sightings in this area…')).toHaveCount(0);
  });
});

test.describe('without location', () => {
  test('says so instead of silently showing the default city', async ({ page }) => {
    await signIn(page, { rpc: { nearby_sightings: () => ({ json: [] }) } });
    await page.goto('/');
    await expect(page.getByText('Turn on location to see cats near you')).toBeVisible();
  });
});
