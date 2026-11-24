import {test, expect, type Page} from '@playwright/test';

async function fixture(page: Page, mentor = false) {
  const uid = '00000000-0000-0000-0000-000000000001';
  await page.addInitScript(uid => localStorage.setItem('4418-team-hub-auth', JSON.stringify({
    access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_at: 4000000000,
    token_type: 'bearer', user: {id: uid, aud: 'authenticated', app_metadata: {}, user_metadata: {}},
  })), uid);
  // All API traffic stays synthetic, including the existing roster-sync side effect.
  await page.route('https://attendance-test.supabase.invalid/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/profiles')) return route.fulfill({json: {id: uid, role: mentor ? 'mentor' : 'student', active: true}});
    if (path.endsWith('/team_dashboard_context')) return route.fulfill({json: {
      name: 'Fixture Member', role: mentor ? 'mentor' : 'student', admin: mentor,
      personal: {percent: null, strikes: 0, pending: 0}, next_meeting: null, orders: [],
      finance: {allowed: false, approvals: 0, school: 0}, attention: null, robot: null, inventory: null, announcements: [],
    }});
    if (path.endsWith('/planning_my_work_context')) return route.fulfill({json: {user_id: uid, seasons: [], boards: [], tasks: []}});
    return route.fulfill({json: []});
  });
}

for (const width of [320, 390, 1440]) {
  test(`student announcements recover from error into an accessible empty destination at ${width}`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    await fixture(page);
    let fail = true;
    await page.route('**/rpc/team_dashboard_context', async route => {
      if (fail) return route.fulfill({status: 500, json: {message: 'Fixture connection interrupted'}});
      await route.fallback();
    });
    await page.goto('/#home-announcements');
    await expect(page.getByRole('alert')).toContainText('Fixture connection interrupted');
    fail = false;
    await page.getByRole('button', {name: 'Try again'}).click();
    const destination = page.locator('#home-announcements');
    await expect(destination).toContainText('You’re up to date. No new announcements.');
    await expect(destination).toBeFocused();
    await expect(destination).toBeInViewport();
    if (width <= 760) await page.getByRole('button', {name: 'Hub menu'}).click();
    const link = page.getByRole('navigation', {name: 'Hub workspace'}).getByRole('link', {name: 'Announcements', exact: true});
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(destination).toBeFocused();
    if (width <= 760) await expect(page.getByRole('button', {name: 'Hub menu'})).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path: `test-results/announcements-empty-${width}.png`, fullPage: true});
  });
}

test('phone menu Escape restores focus and local navigation never strands it in a hidden link', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await fixture(page);
  await page.goto('/');
  await expect(page.getByRole('heading', {name: 'My 4418', exact: true})).toBeVisible();
  const menu = page.getByRole('button', {name: 'Hub menu'});
  await menu.click();
  await page.getByRole('navigation', {name: 'Hub workspace'}).getByRole('link', {name: 'My 4418', exact: true}).focus();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole('navigation', {name: 'Hub workspace'}).getByRole('link', {name: 'My 4418', exact: true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

for (const width of [320, 1440]) test(`mentor creation waits for data and keeps an accessible form at ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 844});
  await fixture(page, true);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  await page.route('**/rest/v1/team_announcements*', async route => {await gate; await route.fulfill({json: []});});
  await page.goto('/#announcements');
  await expect(page.getByText('Loading announcements…', {exact: true})).toBeVisible();
  const create = page.getByRole('button', {name: 'Create announcement', exact: true});
  await expect(create).toBeDisabled();
  release();
  await expect(create).toBeEnabled();
  await create.click();
  const dialog = page.getByRole('dialog', {name: 'Announcement editor'});
  await expect(dialog.getByLabel('Title', {exact: true})).toBeFocused();
  await expect(dialog.getByText('Title and message are required.')).toBeVisible();
  await dialog.getByLabel('Title', {exact: true}).fill('Synthetic build reminder');
  await dialog.getByLabel('Message', {exact: true}).fill('Bring safety glasses.');
  await expect(dialog.getByLabel('Message', {exact: true})).toHaveAttribute('aria-describedby', 'announcement-message-hint');
  expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({path: `test-results/announcement-form-${width}.png`, fullPage: true});
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
});
