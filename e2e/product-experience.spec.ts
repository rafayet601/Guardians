import { test, expect, type Page } from '@playwright/test';

const userId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const rescueId = '33333333-3333-4333-8333-333333333333';
const adoptionId = '44444444-4444-4444-8444-444444444444';
const now = '2026-09-29T18:00:00Z';
const user = {
  id: userId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'guardian@example.test',
  app_metadata: {},
  user_metadata: {},
  created_at: now,
};
const profile = {
  id: userId,
  username: 'Rivu',
  full_name: 'Rivu Quader',
  reports_count: 2,
  rescues_count: 1,
  adoptions_count: 0,
  level: 2,
  points: 70,
  kibble_balance: 70,
  is_guardian: true,
  wants_to_adopt: true,
};
const rescue = {
  id: rescueId,
  title: 'Station tabby',
  status: 'claimed',
  temperament: 'shy',
  reporter_id: otherId,
  claimed_by: userId,
  needs_urgent_help: true,
  created_at: now,
  updated_at: now,
  photos: [],
  lat: 40.7,
  lng: -73.9,
  is_precise: true,
};
const adoptable = {
  ...rescue,
  id: adoptionId,
  title: 'Mochi',
  status: 'available',
  temperament: 'friendly',
  needs_urgent_help: false,
  claimed_by: otherId,
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/** Isolated fixture backend. No real session, external data, or production writes. */
async function signIn(
  page: Page,
  options: {
    empty?: boolean;
    adoptionError?: boolean;
    journeyError?: boolean;
    unclaimed?: boolean;
  } = {},
) {
  let rescueState = options.unclaimed ? { ...rescue, status: 'spotted', claimed_by: null } : rescue;
  await page.route('https://release-test.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = [];
    let status = 200;
    if (url.pathname.endsWith('/auth/v1/token'))
      body = {
        access_token: 'fixture-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'fixture-refresh-token',
        user,
      };
    else if (url.pathname.endsWith('/auth/v1/user')) body = user;
    else if (url.pathname.endsWith('/profiles')) body = profile;
    else if (url.pathname.endsWith('/rpc/get_sighting_detail'))
      body = route.request().postDataJSON().p_sighting === adoptionId ? adoptable : rescueState;
    else if (url.pathname.endsWith('/rpc/claim_sighting')) {
      rescueState = rescue;
      body = rescueState;
    } else if (url.pathname.endsWith('/sightings')) {
      if (url.searchParams.has('or')) {
        if (options.journeyError) {
          body = { message: 'Fixture service unavailable' };
          status = 503;
        } else body = options.empty ? [] : [rescueState];
      } else if (options.adoptionError) {
        body = { message: 'Fixture service unavailable' };
        status = 503;
      } else
        body = options.empty || url.searchParams.get('temperament') === 'eq.shy' ? [] : [adoptable];
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      // The fixture can immediately be retried; avoid SDK backoff obscuring recovery assertions.
      headers: { 'Retry-After': '0', 'Access-Control-Expose-Headers': 'Retry-After' },
      body: JSON.stringify(body),
    });
  });
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill('guardian@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('How will you help today?')).toBeVisible();
}

test('home surfaces claimed rescues and takes a guardian into the real journey screen', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page);
  await expect(page.getByText('Welcome, Rivu')).toBeVisible();
  await expect(page.getByText('Station tabby', { exact: true })).toBeVisible();
  await expect(page.getByText('No photo yet')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/home-mobile.png', fullPage: true });
  await page.getByRole('button', { name: /Station tabby, claimed/ }).click();
  await expect(page).toHaveURL(new RegExp(`/sighting/${rescueId}`));
  await expect(page.getByText('The journey home')).toBeVisible();
  await expect(page.getByLabel('Rescue journey: Rescuing, step 2 of 5')).toBeVisible();
  await page.screenshot({ path: 'test-results/journey-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('adoption discovery filters on the server and explains how interest works', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Give a home', exact: true }).click();
  await expect(page).toHaveURL(/\/adopt$/);
  await expect(page.getByText('Mochi', { exact: true })).toBeVisible();
  const cat = page.getByRole('button', { name: /Mochi, ready to adopt/ });
  // Discovery starts with cats, without requiring a scroll past a long introduction.
  await expect(cat).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'test-results/adopt-mobile.png', fullPage: true });
  const explainer = page.getByRole('button', { name: 'How adoption works', exact: true });
  await explainer.click();
  await expect(explainer).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(/Sending interest isn’t an adoption confirmation/)).toBeVisible();
  await explainer.click();
  await expect(explainer).toHaveAttribute('aria-expanded', 'false');
  const request = page.waitForRequest(
    (request) =>
      request.url().includes('/sightings?') &&
      new URL(request.url()).searchParams.get('temperament') === 'eq.shy',
  );
  await page.getByRole('button', { name: 'Personality: Shy', exact: true }).click();
  await request;
  await expect(page.getByText('No matches for this personality yet')).toBeVisible();
  await page.getByRole('button', { name: 'Show all personalities' }).click();
  await expect(page.getByText('Mochi', { exact: true })).toBeVisible();
});

test('first-time guardians have a next action and nearby help opens the right map filter', async ({
  page,
}) => {
  await signIn(page, { empty: true });
  await expect(page.getByText('Your first small act starts here')).toBeVisible();
  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith('/rpc/nearby_sightings') &&
      request.postDataJSON().p_statuses?.join(',') === 'spotted,claimed,in_rescue',
  );
  await page.getByRole('button', { name: 'Help nearby', exact: true }).click();
  await request;
  await expect(page).toHaveURL(/\/map\?filter=needs_help/);
});

test('an unavailable adoption service shows recovery instead of an empty success state', async ({
  page,
}) => {
  const options = { adoptionError: true };
  await signIn(page, options);
  await page.getByRole('button', { name: 'Give a home', exact: true }).click();
  await expect(page.getByText('Adoption listings couldn’t load')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry listings' })).toBeVisible();
  await expect(page.getByText('Their next chapter is still ahead')).toHaveCount(0);
  options.adoptionError = false;
  await page.getByRole('button', { name: 'Retry listings' }).click();
  await expect(page.getByText('Mochi', { exact: true })).toBeVisible();
  await expect(page.getByText('Adoption listings couldn’t load')).toHaveCount(0);
});

test('a failed journey refresh preserves the last loaded reports and offers recovery', async ({
  page,
}) => {
  const options = { journeyError: false };
  await signIn(page, options);
  await expect(page.getByText('Station tabby', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Give a home', exact: true }).click();
  options.journeyError = true;
  await page.getByRole('tab', { name: /Home/ }).click();
  await expect(page.getByText(/These are your last loaded reports/)).toBeVisible();
  await expect(page.getByText('Station tabby', { exact: true })).toBeVisible();
  options.journeyError = false;
  await page.getByRole('button', { name: 'Retry journeys' }).click();
  await expect(page.getByText(/These are your last loaded reports/)).toHaveCount(0);
});

test('claiming a rescue requires confirmation and advances the journey after accepting', async ({
  page,
}) => {
  let claims = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/rpc/claim_sighting')) claims++;
  });
  await signIn(page, { unclaimed: true });
  await page.getByRole('button', { name: /Station tabby, spotted/ }).click();
  const claimButton = page.getByRole('button', { name: /Claim this rescue/ });
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('coordinating this rescue');
    await dialog.dismiss();
  });
  await claimButton.click();
  await expect(page.getByLabel('Rescue journey: Spotted, step 1 of 5')).toBeVisible();
  expect(claims).toBe(0);
  page.once('dialog', (dialog) => dialog.accept());
  await claimButton.click();
  await expect(page.getByLabel('Rescue journey: Rescuing, step 2 of 5')).toBeVisible();
  expect(claims).toBe(1);
});
