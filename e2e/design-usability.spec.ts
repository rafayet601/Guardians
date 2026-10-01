import { expect, test, type Page } from '@playwright/test';
import { signIn, sighting } from './helpers/mockBackend';

test.use({ deviceScaleFactor: 1 });

const cats = [
  sighting({
    id: '180525a3-1d9d-4ac5-a6ae-c27463fdc9cb',
    reporter_id: null,
    title: 'Tabby near the garden',
    needs_urgent_help: true,
  }),
  sighting({
    id: '63847f73-af61-4d76-a7c2-c7f20b626697',
    reporter_id: null,
    title: 'A kitten ready for a home',
    status: 'available',
  }),
  sighting({
    id: '8cb14cee-3d9d-4ab1-bc09-ead95a131c08',
    reporter_id: null,
    title: 'Grey cat by the steps',
    status: 'in_rescue',
  }),
];

async function feedBackend(page: Page, handler: (url: URL) => { status?: number; json: unknown }) {
  await signIn(page);
  await page.route('https://release-test.supabase.co/rest/v1/sightings?**', async (route) => {
    await route.fulfill(handler(new URL(route.request().url())));
  });
}

for (const width of [320, 390, 1440]) {
  test(`community browsing fits ${width}px and filters the backend`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const filters: string[] = [];
    await feedBackend(page, (url) => {
      const status =
        url.searchParams.getAll('status').find((value) => value.startsWith('in.')) ?? '';
      filters.push(status);
      return { json: status.includes('available') ? [cats[1]] : cats };
    });
    await page.goto('/feed');
    const first = page.getByRole('button', { name: /Tabby near the garden,/ });
    const second = page.getByRole('button', { name: /A kitten ready for a home,/ });
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    const a = (await first.boundingBox())!;
    const b = (await second.boundingBox())!;
    if (width >= 800) {
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(b.x).toBeGreaterThan(a.x + a.width);
    } else {
      expect(b.y).toBeGreaterThan(a.y + a.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    // Optional review artifacts; no user data or live backend is used.
    if (process.env.DESIGN_QA_DIR) {
      await page.screenshot({ path: `${process.env.DESIGN_QA_DIR}/community-${width}.png` });
    }
    await page.getByRole('radio', { name: 'Filter: Adoptable', exact: true }).click();
    await expect(first).toHaveCount(0);
    await expect(second).toBeVisible();
    expect(filters).toContain('in.(available)');
    await expect(
      page.getByRole('radio', { name: 'Filter: Adoptable', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(errors).toEqual([]);
  });
}

test('a filtered empty state offers a working reset and the map prompt navigates', async ({
  page,
}) => {
  await feedBackend(page, (url) => ({
    json: url.searchParams.getAll('status').some((value) => value.includes('adopted')) ? [] : cats,
  }));
  await page.goto('/feed');
  await expect(page.getByText('Tabby near the garden', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Filter: Adopted', exact: true }).click();
  await expect(page.getByText('No adopted sightings yet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show all sightings' }).click();
  await expect(page.getByText('Tabby near the garden', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore nearby cats on the map' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.leaflet-container')).toBeVisible();
});

test('failed refresh keeps cached sightings visible and allows recovery', async ({ page }) => {
  let fail = false;
  await feedBackend(page, () =>
    fail ? { status: 500, json: { message: 'Unavailable' } } : { json: cats },
  );
  await page.goto('/feed');
  await expect(page.getByText('Tabby near the garden', { exact: true })).toBeVisible();
  fail = true;
  await page.getByRole('button', { name: 'Refresh sightings' }).click();
  await expect(
    page.getByText("Couldn't refresh sightings. You're viewing the last loaded results."),
  ).toBeVisible();
  await expect(page.getByText('Tabby near the garden', { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByText("Couldn't refresh sightings. You're viewing the last loaded results."),
  ).toHaveCount(0);
});

test('failed pagination stops automatic requests and retries the missing page', async ({
  page,
}) => {
  let fail = true;
  let pageRequests = 0;
  const firstPage = Array.from({ length: 20 }, (_, i) =>
    sighting({
      id: `row-${i}`,
      title: `Sighting ${i}`,
      created_at: new Date(Date.now() - i * 3600000).toISOString(),
    }),
  );
  await feedBackend(page, (url) => {
    if (!url.searchParams.has('created_at')) return { json: firstPage };
    pageRequests++;
    return fail ? { status: 500, json: { message: 'Unavailable' } } : { json: [cats[1]] };
  });
  await page.goto('/feed');
  await expect(page.getByText('Sighting 0', { exact: true })).toBeVisible();
  // Newly rendered rows change the virtualized scroll height. Keep scrolling
  // until the real next-page request starts instead of assuming one jump suffices.
  await expect
    .poll(
      async () => {
        await page.getByText('Sighting 0', { exact: true }).evaluate((el) => {
          let parent = el.parentElement;
          while (
            parent &&
            getComputedStyle(parent).overflowY !== 'auto' &&
            getComputedStyle(parent).overflowY !== 'scroll'
          )
            parent = parent.parentElement;
          if (parent) parent.scrollTop = parent.scrollHeight;
        });
        return pageRequests;
      },
      { timeout: 15000, intervals: [100, 250, 500] },
    )
    .toBeGreaterThan(0);
  const notice = page.getByText(
    "Couldn't load more sightings. Your current results are still here.",
  );
  await expect(notice).toBeAttached();
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeVisible();
  expect(pageRequests).toBe(3); // initial attempt + the configured two retries
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(600);
  expect(pageRequests).toBe(3);
  fail = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByText('A kitten ready for a home', { exact: true })).toBeVisible();
  expect(pageRequests).toBe(4);
});

test('feed filters support keyboard selection and expose their checked state', async ({ page }) => {
  await feedBackend(page, () => ({ json: cats }));
  await page.goto('/feed');
  const all = page.getByRole('radio', { name: 'Filter: All', exact: true });
  await all.focus();
  await page.keyboard.press('ArrowRight');
  const needsHelp = page.getByRole('radio', { name: 'Filter: Needs a guardian', exact: true });
  await expect(needsHelp).toBeFocused();
  await expect(needsHelp).toBeChecked();
  await page.keyboard.press('End');
  await expect(page.getByRole('radio', { name: 'Filter: Adopted', exact: true })).toBeChecked();
  await page.keyboard.press('Home');
  await expect(all).toBeFocused();
  await expect(all).toBeChecked();
});

for (const screen of ['rewards', 'leaderboard'] as const) {
  test(`${screen} keeps cached results on refresh failure and recovers`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await signIn(page);
    let fail = false;
    const title = screen === 'rewards' ? 'A treat for your next rescue' : 'Community helper';
    const table = screen === 'rewards' ? 'reward_offers' : 'profiles';
    await page.route(`https://release-test.supabase.co/rest/v1/${table}?**`, async (route) => {
      const url = new URL(route.request().url());
      if (screen === 'leaderboard' && !url.searchParams.has('order')) return route.fallback();
      await route.fulfill(
        fail
          ? { status: 500, json: { message: 'Unavailable' } }
          : {
              json:
                screen === 'rewards'
                  ? [
                      {
                        id: 'reward-1',
                        title,
                        cost_kibble: 20,
                        min_level: 1,
                        required_badge_id: null,
                        inventory: null,
                        redeemed_count: 0,
                        once_per_user: false,
                        starts_at: null,
                        ends_at: null,
                        is_active: true,
                        brand: { name: 'Test partner' },
                      },
                    ]
                  : [
                      {
                        id: 'guardian-1',
                        username: title,
                        points: 120,
                        level: 2,
                        rescues_count: 4,
                        avatar_url: null,
                      },
                    ],
            },
      );
    });
    await page.goto(`/${screen}`);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    if (process.env.DESIGN_QA_DIR)
      await page.screenshot({ path: `${process.env.DESIGN_QA_DIR}/${screen}-320.png` });
    fail = true;
    await page
      .getByRole('button', { name: screen === 'rewards' ? 'Refresh rewards' : 'Refresh rankings' })
      .click();
    const notice = page.getByText(
      screen === 'rewards'
        ? "Couldn't refresh rewards. You're viewing the last loaded offers."
        : "Couldn't refresh rankings. You're viewing the last loaded standings.",
    );
    await expect(notice).toBeVisible();
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(notice).toHaveCount(0);
  });
}
