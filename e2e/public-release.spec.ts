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
  await page.goto('/');
  await expect(page).toHaveURL(/welcome/);
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Enter a valid email')).toBeVisible();
  await expect(page.getByText('At least 6 characters')).toBeVisible();
});
