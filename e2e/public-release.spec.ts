import { test, expect } from '@playwright/test';
for (const path of ['privacy', 'terms']) {
  test(`${path} stays public on a mobile viewport`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/${path}`);
    await expect(
      page
        .getByText(path === 'privacy' ? 'Privacy Policy' : 'Terms of Service', { exact: true })
        .last(),
    ).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/${path}-mobile.png`, fullPage: true });
  });
}
test('signed-out app redirects to welcome and sign-in validates input', async ({ page }) => {
  const nearbyRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/rpc/nearby_sightings')) nearbyRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page).toHaveURL(/welcome/);
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Enter a valid email')).toBeVisible();
  await expect(page.getByText('At least 6 characters')).toBeVisible();
  expect(nearbyRequests).toEqual([]);
});

test('signed-in map recovers from a failed nearby-sightings request', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'map-test@example.test',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  let failNearby = true;
  let nearbyRequests = 0;
  await page.route('https://release-test.supabase.co/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/nearby_sightings')) {
      nearbyRequests += 1;
      await route.fulfill({
        status: failNearby ? 503 : 200,
        json: failNearby ? { message: 'Simulated temporary outage' } : [],
      });
      return;
    }
    const response = path.endsWith('/user')
      ? user
      : path.endsWith('/profiles')
        ? { ...user, username: 'Map tester', points: 0, level: 1, is_guardian: true }
        : path.endsWith('/is_moderator')
          ? false
          : [];
    await route.fulfill({ json: response });
  });
  await page.addInitScript((testUser) => {
    localStorage.setItem(
      'sb-release-test-auth-token',
      JSON.stringify({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: testUser,
      }),
    );
    localStorage.setItem('@guardians/primer_location', '1');
    localStorage.setItem(`@guardians/primer_notifications/${testUser.id}`, '1');
  }, user);

  await page.goto('/');
  await expect(page.getByText('Cats nearby', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expand nearby sightings list' }).click();
  await expect(page.getByText('Could not load sightings', { exact: true })).toBeVisible();
  const failedRequests = nearbyRequests;
  expect(failedRequests).toBeGreaterThan(0);
  failNearby = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByText('No sightings in this area yet', { exact: true })).toBeVisible();
  expect(nearbyRequests).toBeGreaterThan(failedRequests);
  expect(errors).toEqual([]);
});
