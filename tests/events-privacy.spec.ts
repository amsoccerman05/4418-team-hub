import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { build, createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parsePublicEvent, parsePublishedEvents, type PublicEvent } from '../src/events/public-model';

const authKey = '4418-team-hub-auth';
const fixture: PublicEvent = {
  slug: 'sample-event', title: 'Sample event', subtitle: 'Synthetic event fixture',
  dateLabel: 'October 10–11, 2026', venue: 'Example venue',
  address: 'Colorado Springs, Colorado', timeZone: 'America/Denver',
  sourceUrl: 'https://coloradofirst.org/frc/kcmt/', sourceChecked: '2026-10-05',
  schedule: [{ date: '2026-10-10', label: 'Saturday', items: [{ time: '7:30 am', title: 'Venue opens' }] }],
  arrival: { status: 'pending', text: 'Team arrival and pickup details are awaiting confirmation.' },
  meals: { status: 'pending', text: 'Team meal arrangements are awaiting confirmation.' },
  visiting: { status: 'pending', text: 'Spectator and packing instructions are awaiting confirmation.' },
  volunteering: { status: 'pending', text: 'Team volunteer needs are awaiting confirmation.' },
};

async function observePrivacy(page: Page, expiresAt: number | null = null) {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ key, expiresAt }) => {
    const original = expiresAt === null ? null : JSON.stringify({
      access_token: 'private-fixture-access-token', refresh_token: 'private-fixture-refresh-token',
      expires_at: expiresAt, token_type: 'bearer',
      user: { id: 'private-fixture-member', aud: 'authenticated', user_metadata: {}, app_metadata: {} },
    });
    if (original !== null) localStorage.setItem(key, original);
    const audit = { storage: [] as string[], channels: [] as string[], messages: [] as string[], original };
    (window as any).__eventPrivacy = audit;
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const originalMethod = Storage.prototype[method];
      (Storage.prototype as any)[method] = function (...args: string[]) {
        if (args[0] === key) audit.storage.push(method);
        return Reflect.apply(originalMethod, this, args);
      };
    }
    const OriginalChannel = window.BroadcastChannel;
    window.BroadcastChannel = class extends OriginalChannel {
      constructor(name: string) { audit.channels.push(name); super(name); }
    };
    const originalListener = window.addEventListener;
    window.addEventListener = function (type: string, ...args: any[]) {
      if (type === 'message' || type === 'storage') audit.messages.push(type);
      return Reflect.apply(originalListener, this, [type, ...args]);
    } as typeof window.addEventListener;
  }, { key: authKey, expiresAt });
  return { requests, errors };
}

async function assertIsolated(page: Page, observed: Awaited<ReturnType<typeof observePrivacy>>) {
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Team sign in', exact: true })).toHaveCount(0);
  await expect(page.locator('.suite-header, .hub-nav, .notification-bell')).toHaveCount(0);
  const audit = await page.evaluate(() => (window as any).__eventPrivacy);
  expect(audit.storage).toEqual([]);
  expect(audit.channels).toEqual([]);
  expect(audit.messages).toEqual([]);
  expect(observed.requests.filter(url => /supabase|suite-auth|suite-broker|\/rest\/v1\/|\/auth\/v1\/|\/src\/(?:attendance|planning|notifications|HubAuth|HubNav|dashboard|team)\//i.test(url))).toEqual([]);
  expect(observed.errors).toEqual([]);
}

test('the shipped public registry is empty after the KCMT guide retirement', () => {
  const registry = JSON.parse(readFileSync('public/events/published.json', 'utf8'));
  expect(registry).toEqual({schemaVersion:1,events:[]});
  expect(parsePublishedEvents(registry)).toEqual([]);
});

test('the public parser reconstructs only the curated contract, including nested values', () => {
  const privateMarker = 'PRIVATE-RECORD-SHOULD-NOT-RENDER';
  const candidate = {
    ...fixture, profiles: [{ display_name: privateMarker }], owner_id: privateMarker,
    contacts: privateMarker, finances: privateMarker, dietary: privateMarker, inventory: privateMarker,
    arrival: { ...fixture.arrival, contact: privateMarker },
    visiting: { ...fixture.visiting, contact: privateMarker },
    schedule: fixture.schedule.map(day => ({ ...day, owners: privateMarker, items: day.items.map(item => ({ ...item, assignee: privateMarker })) })),
  };
  expect(parsePublicEvent(candidate)).toEqual(fixture);
  const parsed = parsePublishedEvents({ schemaVersion: 1, events: [candidate], internalRecords: privateMarker });
  expect(parsed).toEqual([fixture]);
  expect(JSON.stringify(parsed)).not.toContain(privateMarker);
  for (const optional of [true, false]) {
    const event = parsePublicEvent({ ...fixture, schedule: [{ ...fixture.schedule[0], optional }] });
    expect(event.schedule[0].optional).toBe(optional);
  }
});


test('public contact and visitor bullets accept only the bounded plain-text contract', () => {
  const candidate={...fixture,contact:{name:'Example Contact',phone:'+12025550123',privateEmail:'DO-NOT-SHIP'},visiting:{...fixture.visiting,bullets:['Bring safety glasses.']}};
  const event=parsePublicEvent(candidate);
  expect(event.contact).toEqual({name:'Example Contact',phone:'+12025550123'});
  expect(event.visiting.bullets).toEqual(['Bring safety glasses.']);
  expect(JSON.stringify(event)).not.toContain('DO-NOT-SHIP');
  for(const phone of ['tel:+12025550123','+12025550123?body=secret','javascript:alert(1)','202-555-0123','+000012345','+12025550123;ext=4'])expect(()=>parsePublicEvent({...candidate,contact:{name:'Example',phone}})).toThrow();
  for(const bullets of ['not-an-array',[42],Array(9).fill('Too many'),['x'.repeat(301)]])expect(()=>parsePublicEvent({...candidate,visiting:{...fixture.visiting,bullets}})).toThrow();
});

test('public validation rejects unsafe links, malformed dates, duplicates and unsupported data', () => {
  for (const sourceUrl of [
    'javascript:alert(1)', 'data:text/html,unsafe', 'http://coloradofirst.org/frc/kcmt/',
    'https://coloradofirst.org.evil.invalid/frc/kcmt/', 'https://attacker.invalid/',
    'https://coloradofirst.org/frc/kcmt/?email=private@example.invalid',
    'https://coloradofirst.org/frc/kcmt/#private-contact',
    'https://user:password@coloradofirst.org/frc/kcmt/',
  ]) expect(() => parsePublicEvent({ ...fixture, sourceUrl })).toThrow();
  for (const slug of ['../private', 'KCMT', 'kcmt/2026', 'kcmt?private=1', '']) {
    expect(() => parsePublicEvent({ ...fixture, slug })).toThrow();
  }
  for (const sourceChecked of ['2026-02-30', '2026-13-01', '2026-10-05T00:00:00Z', 'not-a-date']) {
    expect(() => parsePublicEvent({ ...fixture, sourceChecked })).toThrow();
  }
  expect(() => parsePublicEvent({ ...fixture, timeZone: 'UTC' })).toThrow();
  expect(() => parsePublicEvent({ ...fixture, arrival: { status: 'approved', text: 'Unreviewed' } })).toThrow();
  expect(() => parsePublicEvent({ ...fixture, visiting: undefined })).toThrow();
  for (const optional of ['true', 'false', 1, 0, null, {}]) {
    expect(() => parsePublicEvent({ ...fixture, schedule: [{ ...fixture.schedule[0], optional }] })).toThrow();
  }
  expect(() => parsePublicEvent({ ...fixture, schedule: [] })).toThrow();
  expect(() => parsePublishedEvents({ schemaVersion: 2, events: [fixture] })).toThrow();
  expect(() => parsePublishedEvents({ schemaVersion: 1, events: [fixture, fixture] })).toThrow();
  expect(() => parsePublishedEvents({ schemaVersion: 1, events: [{ ...fixture, sourceUrl: 'https://attacker.invalid/' }, fixture] })).toThrow();
});

test('pure public rendering escapes text and includes no internal record fields', async () => {
  const server = await createServer({ logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { EventDetails } = await server.ssrLoadModule('/src/events/EventDetails.tsx');
    const event = parsePublicEvent({ ...fixture,
      title: '</h1><script>UNTRUSTED-TEXT</script>',
      profiles: ['PRIVATE-RECORD-SHOULD-NOT-RENDER'],
      meals: { ...fixture.meals, dietary: 'PRIVATE-RECORD-SHOULD-NOT-RENDER' },
    });
    const html = renderToStaticMarkup(createElement(EventDetails, { event }));
    expect(html).toContain('&lt;/h1&gt;&lt;script&gt;UNTRUSTED-TEXT&lt;/script&gt;');
    expect(html).not.toMatch(/<script|PRIVATE-RECORD-SHOULD-NOT-RENDER|4418-team-hub-auth|suite-auth|notification-bell/);
    expect(html).toContain(fixture.meals.text);
    expect(html).toContain(fixture.visiting.text);
    expect(html).toContain('rel="noopener noreferrer"');
    const published = parsePublicEvent({...fixture, contact:{name:'Example Contact',phone:'+12025550123'}, schedule:[{...fixture.schedule[0],label:'Friday · Load-in & practice',optional:true}]});
    const guide = renderToStaticMarkup(createElement(EventDetails, { event: published }));
    expect(guide.match(/Optional for Team 4418/g)).toHaveLength(1);
    expect(guide).toContain('Friday · Load-in &amp; practice');
    expect(guide).toContain('Before you go');
    expect(guide).toContain('Team details awaiting confirmation');
    expect(guide).not.toMatch(/<form|<input|<select|<textarea|<iframe|mailto:|Planning board|prep tasks/);
    expect(guide.match(/href="tel:[^"]+"/g)).toEqual(['href="tel:+12025550123"']);
    expect(guide).toContain('Example Contact');expect(guide).toContain('202-555-0123');
    const required = parsePublicEvent({ ...fixture, schedule: [{ ...fixture.schedule[0], optional: false }] });
    expect(renderToStaticMarkup(createElement(EventDetails, { event: required }))).not.toContain('Optional for Team 4418');
  } finally { await server.close(); }
});

for (const width of [390, 1440]) test(`approved fixture is public-only, escaped and readable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const observed = await observePrivacy(page, 4_000_000_000);
  await page.route('**/events/published.json', route => route.fulfill({ json: {
    schemaVersion: 1,
    events: [{ ...fixture, privateRecords: 'PRIVATE-RECORD-SHOULD-NOT-RENDER', subtitle: '<img src=x onerror="alert(1)">Public fixture' }],
  } }));
  await page.goto('/event.html#sample-event');
  await expect(page.getByRole('heading', { name: 'Sample event', exact: true })).toBeVisible();
  await expect(page.locator('body')).toContainText(fixture.arrival.text);
  await expect(page.locator('body')).toContainText(fixture.meals.text);
  await expect(page.locator('body')).toContainText('<img src=x onerror="alert(1)">Public fixture');
  await expect(page.locator('img[onerror]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('PRIVATE-RECORD-SHOULD-NOT-RENDER');
  await expect(page.getByRole('link', { name: 'Official event information' })).toHaveAttribute('href', fixture.sourceUrl);
  await expect(page.getByRole('link', { name: 'Official event information' })).toHaveAttribute('rel', 'noopener noreferrer');
  const signInHref = await page.getByRole('link', { name: 'Team sign in →', exact: true }).getAttribute('href');
  expect(signInHref).not.toBeNull();
  const signInUrl = new URL(signInHref!, page.url());
  expect(signInUrl.pathname).toMatch(/\/index\.html$/);
  expect(signInUrl.hash).toBe('#events/sample-event');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const skip=page.getByRole('link', { name: 'Skip to content' });
  await skip.focus();
  expect(await skip.evaluate(element=>{const r=element.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return top===element||element.contains(top);})).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.locator('#event-content')).toBeFocused();
  expect(page.url()).toContain('#sample-event');
  await assertIsolated(page, observed);
});

for (const width of [390, 1440]) test(`retired KCMT guide is unavailable and contains no former content at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});const observed=await observePrivacy(page);
  await page.goto('/event.html#kcmt-2026');
  await expect(page.getByRole('heading',{name:'Event information is unavailable',exact:true})).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/KCMT|Coronado|October 10|720-525-3196|Aiden Morrison|Optional for Team 4418/);
  await expect(page.locator('a[href^="tel:"],a[href*="#events/"],form,input,select,textarea,.event-hero')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Team sign in →',exact:true})).toHaveAttribute('href',/index\.html$/);
  await expect(page.getByRole('link',{name:'Visit the team website'})).toHaveAttribute('href','https://www.frc4418.org');
  await expect(page.locator('.event-public-brand img')).toHaveAttribute('src',/branding\/4418-impulse-emblem\.png$/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/event-public-retired-${width}.png`,fullPage:true});
  await page.reload();await expect(page.getByRole('heading',{name:'Event information is unavailable',exact:true})).toBeVisible();
  await assertIsolated(page,observed);
});

test('invalid public data fails closed and a retry recovers without authenticating', async ({ page }) => {
  const observed = await observePrivacy(page);
  let approved = false;
  await page.route('**/events/published.json', route => route.fulfill({ json: {
    schemaVersion: 1, events: [{ ...fixture, sourceUrl: approved ? fixture.sourceUrl : 'https://attacker.invalid/' }],
  } }));
  await page.goto('/event.html#sample-event');
  await expect(page.getByRole('heading', { name: 'Event information is unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toHaveCount(0);
  approved = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible();
  await page.evaluate(() => { location.hash = 'unknown-event'; });
  await expect(page.locator('body')).toContainText(/unavailable/i);
  await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: fixture.title, exact: true })).toBeVisible();
  await assertIsolated(page, observed);
});

for (const state of [
  { name: 'signed out', expiresAt: null },
  { name: 'existing signed-in storage', expiresAt: 4_000_000_000 },
  { name: 'expired signed-in storage', expiresAt: 1 },
]) {
  test(`unpublished parent event fails closed with ${state.name}`, async ({ page }) => {
    const observed = await observePrivacy(page, state.expiresAt);
    await page.goto('/event.html#unpublished-event');
    await expect(page.locator('body')).toContainText(/not published|isn[’\']t published|not available|unavailable/i);
    await expect(page.locator('body')).not.toContainText(/Coronado|KCMT|October 10|Oct 10|private-fixture/i);
    await assertIsolated(page, observed);
  });
}

test('unknown slugs and authentication callback values never bootstrap a session', async ({ page }) => {
  const observed = await observePrivacy(page, 1);
  await page.goto('/event.html?code=private-callback-code&password-reset=1#access_token=private-callback-access&refresh_token=private-callback-refresh&type=recovery');
  await expect(page.locator('body')).toContainText(/not published|isn[’\']t published|not available|unavailable/i);
  await expect(page.locator('body')).not.toContainText(/private-callback|Set your password/);
  expect(page.url()).toContain('code=private-callback-code');
  await page.evaluate(() => { location.hash = 'unknown-event'; });
  await expect(page.locator('body')).toContainText(/not published|isn[’\']t published|not available|unavailable/i);
  await assertIsolated(page, observed);
});

test('the built public entry cannot import or preload authenticated code or draft content', async () => {
  test.setTimeout(60_000);
  const built = await build({ logLevel: 'silent', build: { write: false, minify: false } });
  const outputs = (Array.isArray(built) ? built : [built]).flatMap(result => 'output' in result ? result.output : []);
  const chunks = outputs.filter(output => output.type === 'chunk');
  for (const chunk of chunks) expect(chunk.code).not.toMatch(/kcmt-2026|KCMT 2026|Kendrick Castillo Memorial Tournament|Coronado High School|17205253196|720-525-3196|Aiden Morrison/);
  const entry = chunks.find(chunk => chunk.isEntry && chunk.facadeModuleId?.endsWith('/event.html'));
  expect(entry, 'event.html must be a distinct build entry').toBeDefined();
  const visited = new Set<string>();
  function inspect(fileName: string) {
    if (visited.has(fileName)) return;
    visited.add(fileName);
    const chunk = chunks.find(chunk => chunk.fileName === fileName);
    expect(chunk, `missing public dependency ${fileName}`).toBeDefined();
    if (!chunk) return;
    const modules = Object.keys(chunk.modules);
    expect(modules.filter(module => /(?:node_modules\/@supabase\/|\/src\/(?:attendance|planning|notifications|dashboard|team)\/|\/src\/(?:HubAuth|HubNav|SuiteHeader|suite-auth|suite-broker)\.|\/src\/events\/event-config\.)/.test(module)), `private modules in ${fileName}`).toEqual([]);
    expect(chunk.code).not.toMatch(/4418-team-hub-auth|4418-suite-auth-v1|private-fixture/);
    for (const imported of [...chunk.imports, ...chunk.dynamicImports]) inspect(imported);
  }
  inspect(entry!.fileName);
  const html = outputs.find(output => output.type === 'asset' && output.fileName === 'event.html');
  expect(html?.type).toBe('asset');
  if (html?.type === 'asset') {
    const text = typeof html.source === 'string' ? html.source : Buffer.from(html.source).toString();
    for (const match of text.matchAll(/(?:src|href)="\.\/([^\"]+\.js)"/g)) {
      expect(visited.has(match[1]), `unexpected preload or script ${match[1]}`).toBe(true);
    }
  }
});
