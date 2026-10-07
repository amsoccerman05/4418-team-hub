// Synthetic-only fixture. Caller owns a newly created disposable database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syntheticMailApproval } from '../helpers/meal-delivery-fixture.ts';
export async function installMealsFixture(sql) {
  assert.equal(await sql("select coalesce(to_regnamespace('meals_private')::text,'absent')"), 'absent', 'Refusing an existing meals database');
  await sql(readFileSync(new URL('../../supabase/drafts/saturday-meals.sql', import.meta.url), 'utf8'));
  // The reviewed draft remains fail-closed with a zero mail budget. This fixture
  // grants a synthetic allowance only in this newly created isolated database.
  await sql(syntheticMailApproval(500));
}
export function syntheticMeal(title = 'Synthetic Saturday meal', needed = 2) {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 14 + ((6 - date.getUTCDay() + 7) % 7)); date.setUTCHours(12, 0, 0, 0);
  return { title, service_at: date.toISOString(), timezone: 'UTC', expected_headcount: 20,
    guidance: 'Synthetic review only. Label ingredients.', status: 'open',
    slots: [{ label: 'Synthetic main', category: 'main', unit: 'servings', needed }] };
}
