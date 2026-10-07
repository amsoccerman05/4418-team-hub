import { test, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createPostgresMealGateway, digestBytes } from '../supabase/functions/team-meals/postgres-gateway.ts';
import { PostgresMealDatabase } from '../supabase/functions/team-meals/postgres.ts';
import type { MealSqlConnection, MealSqlPool } from '../supabase/functions/team-meals/postgres.ts';
import { MockMealMailer } from '../supabase/functions/team-meals/mail.ts';

// Independent regression: equivalent UUID spellings represent one retry scope.
test('UUID letter casing cannot reserve or send a duplicate idempotent claim', async () => {
  const db = new PGlite();
  const managerId = '00000000-0000-0000-0000-000000000001';
  const pool: MealSqlPool = { connect: async () => ({
    query: async <Row>(sql: string, values: unknown[] = []) => ({ rows: (await db.query<Row>(sql, values)).rows }),
    release() {},
  }) };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.profiles(id uuid primary key, role text, active boolean);
      insert into public.profiles values('${managerId}','mentor',true);`);
    await db.exec(readFileSync('supabase/drafts/saturday-meals.sql', 'utf8'));
    await db.exec('update meals_private.mail_budget set daily_limit=100');
    const saturday = new Date(Date.now() + 14 * 86400000);
    saturday.setUTCDate(saturday.getUTCDate() + (6 - saturday.getUTCDay() + 7) % 7);
    saturday.setUTCHours(12, 0, 0, 0);
    const meal = await new PostgresMealDatabase(pool).saveMeal({ id: managerId }, {
      title: 'Synthetic case replay', service_at: saturday.toISOString(), timezone: 'UTC',
      expected_headcount: 3, guidance: 'Synthetic fixture only.', status: 'open',
      slots: [{ label: 'Synthetic main', category: 'main', unit: 'servings', needed: 3 }],
    });
    const mailer = new MockMealMailer(), origin = 'https://review.invalid';
    const gateway = createPostgresMealGateway({ pool, mailer, allowedOrigins: [origin], publicBaseUrl: `${origin}/meals.html` });
    const body = { operation: 'claim', meal_id: meal.id, slot_id: meal.slots[0].id, whole_meal: false,
      quantity: 1, name: 'Synthetic Reviewer Adult', email: 'reviewer@example.invalid', idempotency_key: 'same-synthetic-request-key' };
    for (const mealId of [meal.id.toLowerCase(), meal.id.toUpperCase()]) {
      const response = await gateway.handle(new Request(`${origin}/api`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, meal_id: mealId }),
      }));
      expect(response.status).toBe(200);
    }
    expect((await db.query<{ n: number }>('select count(*)::int n from meals_private.claims')).rows[0].n).toBe(1);
    expect((await db.query<{ used: number }>('select used from meals_private.mail_budget')).rows[0].used).toBe(1);
    expect(mailer.attempts).toHaveLength(1);
  } finally { await db.close(); }
});

for (const phase of ['commit', 'rollback'] as const) {
  test(`uncertain ${phase} cannot fall through to another capability purpose`, async () => {
    let operations = 0;
    const discarded: boolean[] = [];
    const invalidLink = () => Object.assign(new Error('Invalid or expired link'), { code: 'P0001' });
    const connection: MealSqlConnection = {
      query: async <Row>(sql: string) => {
        if (sql.includes('meals_private.inspect')) {
          operations++;
          if (phase === 'rollback' && operations === 1) throw invalidLink();
        }
        if (phase === 'commit' && sql === 'commit' && operations === 1) throw invalidLink();
        if (phase === 'rollback' && sql === 'rollback' && operations === 1) throw Error('Synthetic rollback disconnect');
        return { rows: [{ result: { synthetic: true } }] as Row[] };
      },
      release: error => { discarded.push(Boolean(error)); },
    };
    const database = new PostgresMealDatabase({ connect: async () => connection });
    await expect(database.inspect([await digestBytes('synthetic-access'), await digestBytes('synthetic-manage')]))
      .rejects.toMatchObject({ status: 503, code: 'uncertain_result' });
    expect(operations).toBe(1);
    expect(discarded).toEqual([true]);
  });
}
