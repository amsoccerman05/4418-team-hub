import { test, expect, type Page } from '@playwright/test';
import type { MealDraft, MealManagerSnapshot } from '../src/meals/types';

const snapshot = (): MealManagerSnapshot => ({
  mail_mode: 'mock', daily_budget_remaining: 12,
  meals: [{ id: 'meal-1', title: 'Saturday build lunch', service_at: '2026-10-10T16:00:00.000Z', timezone: 'America/New_York', expected_headcount: 40, guidance: 'Label ingredients. Include a vegetarian option.', status: 'open', whole_meal: 'coordination_required', version: 3,
    slots: [{ id: 'slot-1', category: 'main', label: 'Main dishes', unit: 'servings', needed: 40, confirmed: 12, held: 8, remaining: 20 }, { id: 'slot-2', category: 'supply', label: 'Paper plates', unit: 'packs', needed: 2, confirmed: 0, held: 0, remaining: 2 }] }],
  claims: [
    { id: 'claim-1', meal_id: 'meal-1', slot_id: 'slot-1', whole_meal: false, quantity: 12, name: 'Test Adult', email: 'adult@example.test', status: 'confirmed', email_status: 'sent', hold_expires_at: null, version: 2 },
    { id: 'claim-2', meal_id: 'meal-1', slot_id: 'slot-1', whole_meal: false, quantity: 8, name: 'Pending Adult', email: 'pending@example.test', status: 'pending', email_status: 'queued', hold_expires_at: '2026-10-09T19:00:00Z', version: 1 },
    { id: 'claim-3', meal_id: 'meal-1', slot_id: 'slot-2', whole_meal: false, quantity: 1, name: 'Cancelled Adult', email: 'cancelled@example.test', status: 'cancelled', email_status: 'failed', hold_expires_at: null, version: 3 },
    { id: 'claim-4', meal_id: 'meal-1', slot_id: null, whole_meal: true, quantity: 1, name: 'Expired Adult', email: 'expired@example.test', status: 'expired', email_status: 'uncertain', hold_expires_at: null, version: 1 },
  ],
});
type Failure = { code: string; message: string; status?: number };
async function fixture(page: Page) {
  const state = { data: snapshot(), saves: [] as MealDraft[], cancellations: [] as {id: string; version: number; reason: string}[], saveError: null as Failure | null, cancelError: null as Failure | null, managerError: null as Failure | null, saveWait: null as Promise<void> | null };
  await page.addInitScript(() => localStorage.setItem('4418-team-hub-auth', JSON.stringify({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_at: 4000000000, token_type: 'bearer', user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', app_metadata: {}, user_metadata: {} } })));
  // All application service operations use this in-memory fake, never a real API.
  await page.route('**/src/meals/service.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    const call = async (operation, payload, signal) => {
      const response = await fetch('/__meal_manager_api', { method: 'POST', body: JSON.stringify({ operation, payload }), signal });
      const body = await response.json();
      if (body.error) throw Object.assign(new Error(body.error.message), body.error);
      return body.result;
    };
    export const mealApi = { manager: signal => call('manager', null, signal), saveMeal: meal => call('save', meal), cancelClaim: claim => call('cancel', claim) };
  ` }));
  await page.route('**/rest/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/profiles')) return route.fulfill({ json: { id: '00000000-0000-0000-0000-000000000001', display_name: 'Synthetic Mentor', role: 'mentor', active: true } });
    if (path.endsWith('/notification_center')) return route.fulfill({ json: { unread: 0, attention: [], items: [], has_more: false } });
    return route.fulfill({ json: [] });
  });
  await page.route('**/__meal_manager_api', async route => {
    const { operation, payload } = route.request().postDataJSON();
    if (operation === 'manager') return route.fulfill({ json: state.managerError ? { error: state.managerError } : { result: structuredClone(state.data) } });
    if (operation === 'save') {
      state.saves.push(payload);
      if (state.saveWait) await state.saveWait;
      if (state.saveError) return route.fulfill({ json: { error: state.saveError } });
      const old = state.data.meals.find(meal => meal.id === payload.id);
      const saved = { ...payload, id: payload.id || `meal-${state.data.meals.length + 1}`, version: (payload.version || 0) + 1, whole_meal: old?.whole_meal || 'available', slots: payload.slots.map((slot: MealDraft['slots'][number], index: number) => ({ ...slot, id: slot.id || `new-slot-${index}`, confirmed: old?.slots.find(s => s.id === slot.id)?.confirmed || 0, held: old?.slots.find(s => s.id === slot.id)?.held || 0, remaining: slot.needed - (old?.slots.find(s => s.id === slot.id)?.confirmed || 0) - (old?.slots.find(s => s.id === slot.id)?.held || 0) })) };
      state.data.meals = [...state.data.meals.filter(meal => meal.id !== saved.id), saved];
      if (saved.status === 'cancelled') for (const claim of state.data.claims) { if (claim.meal_id === saved.id && ['pending', 'confirmed'].includes(claim.status)) { claim.status = 'cancelled'; claim.version++; } }
      return route.fulfill({ json: { result: saved } });
    }
    state.cancellations.push(payload);
    if (state.cancelError) return route.fulfill({ json: { error: state.cancelError } });
    const claim = state.data.claims.find(item => item.id === payload.id)!;
    claim.status = 'cancelled'; claim.version++;
    return route.fulfill({ json: { result: null } });
  });
  return state;
}
async function open(page: Page) {
  await page.goto('/#meals');
  await expect(page.getByRole('heading', { name: 'Saturday meals', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Saturday build lunch', exact: true })).toBeVisible();
}

for (const width of [390, 1440]) test(`coordinator coverage and private adult contacts at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await fixture(page); await open(page);
  await expect(page.getByText('Test email mode', { exact: true })).toBeVisible();
  await expect(page.getByText('Whole meal needs coordination', { exact: true })).toBeVisible();
  await expect(page.getByText('adult@example.test', { exact: true })).toBeVisible();
  for (const label of ['Email provider accepted', 'Email queued', 'Email failed', 'Email outcome uncertain']) await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText('20 servings remaining', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Contribution status', exact: true }).selectOption('expired');
  await expect(page.getByRole('article', { name: 'Contribution from Expired Adult' })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Contribution from Test Adult' })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Contribution status', exact: true }).selectOption('all');
  await page.getByRole('button', { name: 'Edit meal', exact: true }).click();
  await expect(page.getByText('Visible on the public signup page.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Meal date and local time', { exact: true })).toHaveValue('2026-10-10T12:00');
  await expect(page.getByRole('button', { name: 'Remove slot 1', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save meal', exact: true })).toBeDisabled();
  await page.getByLabel('Meal title', { exact: true }).fill('Updated Saturday lunch');
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Meal saved. Version 4.');
  expect(state.saves).toHaveLength(1); expect(state.saves[0].version).toBe(3); expect(state.saves[0].service_at).toBe('2026-10-10T16:00:00.000Z');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/meals-manager-${width}.png`, fullPage: true });
});

test('stale writes preserve the draft and cannot overwrite a newer version', async ({ page }) => {
  const state = await fixture(page); await open(page);
  state.saveError = { code: 'stale_version', message: 'The meal version changed. Reload and review.', status: 409 };
  await page.getByRole('button', { name: 'Edit meal', exact: true }).click();
  await page.getByLabel('Meal title', { exact: true }).fill('My unsaved lunch');
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByLabel('Meal title', { exact: true })).toHaveValue('My unsaved lunch');
  await expect(page.getByText('This save needs coordination or a newer meal version.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save meal', exact: true })).toBeDisabled();
  state.data.meals[0].version = 4; state.data.meals[0].title = 'Another coordinator’s lunch';
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Latest coverage');
  await expect(page.getByLabel('Meal title', { exact: true })).toHaveValue('My unsaved lunch');
  await expect(page.getByRole('button', { name: 'Save meal', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Discard unsaved changes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit meal', exact: true }).click();
  await expect(page.getByLabel('Meal title', { exact: true })).toHaveValue('Another coordinator’s lunch');
  expect(state.saves).toHaveLength(1);
});

test('cancellation requires a reason and affects only the selected contribution', async ({ page }) => {
  const state = await fixture(page); await open(page);
  await page.getByRole('button', { name: 'Cancel contribution from Test Adult', exact: true }).click();
  const form = page.getByRole('form', { name: 'Cancel contribution', exact: true });
  await expect(form.getByRole('button', { name: 'Confirm cancellation' })).toBeDisabled();
  await form.getByRole('textbox', { name: 'Cancellation reason', exact: true }).fill('Volunteer requested cancellation');
  await form.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('status')).toHaveText('Contribution cancelled. Other contributions are unchanged.');
  expect(state.cancellations).toEqual([{ id: 'claim-1', version: 2, reason: 'Volunteer requested cancellation' }]);
  await expect(page.getByRole('article', { name: 'Contribution from Test Adult' })).toContainText('cancelled');
  await expect(page.getByRole('article', { name: 'Contribution from Pending Adult' })).toContainText('pending');
  expect(state.data.claims).toHaveLength(4);
});

test('uncertain cancellation keeps the reason and blocks duplicate actions', async ({ page }) => {
  const state = await fixture(page); await open(page);
  state.cancelError = { code: 'uncertain_result', message: 'The result is uncertain.', status: 0 };
  await page.getByRole('button', { name: 'Cancel contribution from Test Adult', exact: true }).click();
  await page.getByRole('textbox', { name: 'Cancellation reason', exact: true }).fill('Volunteer requested cancellation');
  await page.getByRole('button', { name: 'Confirm cancellation' }).click();
  await expect(page.getByRole('textbox', { name: 'Cancellation reason', exact: true })).toHaveValue('Volunteer requested cancellation');
  await expect(page.getByRole('button', { name: 'Confirm cancellation' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Close cancellation form' })).toBeVisible();
  expect(state.cancellations).toHaveLength(1);
});

test('uncertain new-meal save blocks duplicate creation and preserves all fields', async ({ page }) => {
  const state = await fixture(page); await open(page);
  state.saveError = { code: 'uncertain_result', message: 'Could not confirm the result.', status: 0 };
  await page.getByRole('button', { name: 'Add a meal', exact: true }).click();
  await page.getByLabel('Meal title', { exact: true }).fill('New Saturday meal');
  await page.getByLabel('Meal date and local time', { exact: true }).fill('2026-10-17T12:00');
  await page.getByLabel('Timezone', { exact: true }).fill('America/New_York');
  await page.getByLabel('Expected headcount', { exact: true }).fill('35');
  await page.getByLabel('Slot label', { exact: true }).fill('Lunch');
  await page.getByLabel('Quantity needed', { exact: true }).fill('35');
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByText('The save result is uncertain.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Meal title', { exact: true })).toHaveValue('New Saturday meal');
  await expect(page.getByRole('button', { name: 'Save meal', exact: true })).toBeDisabled();
  expect(state.saves).toHaveLength(1);
});

test('meal cancellation records a reason without dropping any volunteer', async ({ page }) => {
  const state = await fixture(page); await open(page);
  await page.getByRole('button', { name: 'Edit meal', exact: true }).click();
  await page.getByRole('combobox', { name: 'Signup state', exact: true }).selectOption('cancelled');
  await expect(page.getByText('Cancelling this date closes signups', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: 'Meal cancellation reason', exact: true }).fill('Build session cancelled');
  await expect(page.getByRole('button', { name: 'Save meal', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I understand this cancels all pending/ }).check();
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('history is retained');
  expect(state.saves[0].cancellation_reason).toBe('Build session cancelled');
  expect(state.saves[0].acknowledge_cancellation).toBe(true);
  await expect(page.getByRole('article', { name: 'Contribution from Test Adult' })).toContainText('cancelled');
  await expect(page.getByRole('article', { name: 'Contribution from Pending Adult' })).toContainText('cancelled');
  expect(state.data.claims).toHaveLength(4); expect(state.cancellations).toHaveLength(0);
});

test('server authorization denial hides private contacts and controls', async ({ page }) => {
  const state = await fixture(page);
  state.managerError = { code: 'forbidden', message: 'Active mentors and admins only.', status: 403 };
  await page.goto('/#meals');
  await expect(page.getByRole('heading', { name: 'Meal management access required' })).toBeVisible();
  await expect(page.getByText('adult@example.test', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a meal', exact: true })).toHaveCount(0);
  expect(state.saves).toHaveLength(0);
});

test('permission revocation clears an open draft and cached contacts', async ({ page }) => {
  const state = await fixture(page); await open(page);
  await page.getByRole('button', { name: 'Edit meal', exact: true }).click();
  await page.getByLabel('Meal title', { exact: true }).fill('Private draft');
  state.saveError = { code: 'manager_required', message: 'Coordinator access is required.', status: 403 };
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meal management access required' })).toBeVisible();
  await expect(page.getByLabel('Meal title', { exact: true })).toHaveCount(0);
  await expect(page.getByText('adult@example.test', { exact: true })).toHaveCount(0);
});

test('DST gaps and ambiguous times are rejected before any write', async ({ page }) => {
  const state = await fixture(page); state.data.claims = []; await open(page);
  await page.getByRole('button', { name: 'Edit meal', exact: true }).click();
  await page.getByLabel('Meal date and local time', { exact: true }).fill('2027-03-14T02:30');
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('does not exist because of daylight saving time');
  await page.getByLabel('Meal date and local time', { exact: true }).fill('2026-11-01T01:30');
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('occurs twice because of daylight saving time');
  expect(state.saves).toHaveLength(0);
});

test('busy writes cannot be repeated and completion after navigation cannot reopen the editor', async ({ page }) => {
  const state = await fixture(page); await open(page);
  let release!: () => void;
  state.saveWait = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Edit meal', exact: true }).click();
  await page.getByLabel('Meal title', { exact: true }).fill('Saved once');
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Meal title', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeDisabled();
  await page.evaluate(() => { location.hash = '#events'; });
  release();
  await expect(page.getByRole('heading', { name: 'Saturday meals', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Meal title', { exact: true })).toHaveCount(0);
  expect(state.saves).toHaveLength(1);
});

test('uncommitted slots can be added and removed with categories and units retained', async ({ page }) => {
  const state = await fixture(page); await open(page);
  await page.getByRole('button', { name: 'Edit meal', exact: true }).click();
  await page.getByRole('button', { name: 'Remove slot 2', exact: true }).click();
  await page.getByRole('button', { name: 'Add slot', exact: true }).click();
  const slot = page.getByRole('group', { name: 'Contribution slot 2', exact: true });
  await slot.getByLabel('Slot label', { exact: true }).fill('Fruit');
  await slot.getByRole('combobox', { name: 'Category', exact: true }).selectOption('side');
  await slot.getByLabel('Quantity needed', { exact: true }).fill('3');
  await slot.getByLabel('Unit label', { exact: true }).fill('trays');
  await page.getByRole('button', { name: 'Save meal', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Meal saved.');
  expect(state.saves[0].slots[1]).toEqual({ label: 'Fruit', category: 'side', unit: 'trays', needed: 3 });
});
