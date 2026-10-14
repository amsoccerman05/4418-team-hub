import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const approved: string[] = JSON.parse(readFileSync(new URL('./fixtures/privacy-approved-text.json', import.meta.url), 'utf8'));
for (const width of [390, 1280]) {
 test(`public privacy notice at ${width}px is independent of sign-in`, async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4422', viewport: { width, height: 900 }, javaScriptEnabled: false });
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('/privacy.html');
  await expect(page).toHaveTitle('Privacy Notice | Team 4418 IMPULSE');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Team 4418 Privacy Notice');
  await expect(page.getByText('Effective date: October 13, 2026')).toBeVisible();
  await expect(page.locator('h2')).toHaveCount(10);
  await expect(page.locator('main li')).toHaveCount(15);
  const content = await page.locator('main').innerText();
  const normalized = content.replace(/\s+/g, ' ');
  for (const paragraph of approved) expect(normalized).toContain(paragraph.replace(/\s+/g, ' '));
  expect(content).not.toContain('Draft for review');
  expect(content).not.toContain('Pending approval');
  await expect(page.locator('form, input, iframe, script')).toHaveCount(0);
  expect(requests.every(url => new URL(url).origin === 'http://127.0.0.1:4422')).toBeTruthy();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(horizontalOverflow).toBeFalsy();
  await expect(page.getByRole('link', { name: 'First4418@gmail.com', exact: true }).first()).toHaveAttribute('href', 'mailto:First4418@gmail.com');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to privacy notice' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.screenshot({ path: `test-results/privacy-${width}.png`, fullPage: true });
  await context.close();
 });
}
test('Team Hub sign-in exposes a safe public privacy link', async ({ page }) => {
 await page.goto('/');
 const link = page.getByRole('link', { name: 'Privacy Notice', exact: true });
 await expect(link).toBeVisible();
 await expect(link).toHaveAttribute('href', /^(?:\.\/|\/)privacy\.html$/);
 await expect(link).toHaveAttribute('target', '_blank');
 await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
 const popupPromise = page.waitForEvent('popup');
 await link.click();
 const popup = await popupPromise;
 await expect(popup.getByRole('heading', { level: 1 })).toHaveText('Team 4418 Privacy Notice');
 await popup.close();
 await expect(page.getByRole('heading', { name: 'Team sign in' })).toBeVisible();
});

test('public event shell links to the notice without exposing retired guides', async ({ page }) => {
 await page.goto('/event.html#retired-event');
 await expect(page.getByRole('heading', {name: 'Event information is unavailable'})).toBeVisible();
 const link = page.getByRole('link', {name: 'Privacy Notice', exact: true});
 await expect(link).toHaveAttribute('href', /^(?:\.\/|\/)privacy\.html$/);
 await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});
