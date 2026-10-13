import {test, expect} from '@playwright/test';
import {inventoryLocationQuery, scannedInventoryLocation} from '../src/inventory-return';
import {session} from './hub-session';
const id = '10000000-0000-4000-8000-000000000001';
const query = `?inventory_location=${id}`;
const target = `https://inventory.frc4418.org/#location/${id}`;
const uid = '00000000-0000-0000-0000-000000000001';

test('return destination permits one UUID only and always generates the fixed inventory route', () => {
  expect(scannedInventoryLocation(query)).toBe(id);
  expect(inventoryLocationQuery(`?inventory_location=${id.toUpperCase()}&redirect=https://evil.invalid&access_token=ignored`)).toBe(query);
  for (const value of ['', 'https://evil.invalid/', '//evil.invalid', '#location/'+id, id+'?x=y', id+'/extra', id+'#access_token=x', ' '+id]) {
    expect(scannedInventoryLocation(`?inventory_location=${encodeURIComponent(value)}`)).toBeNull();
  }
  expect(scannedInventoryLocation(`${query}&inventory_location=${id}`)).toBeNull();
  expect(inventoryLocationQuery('?redirect=https://inventory.frc4418.org/#location/'+id)).toBe('');
});

test('scan destination survives signed-out reload and sign-in; no protected link or popup appears before authentication', async ({page, context}) => {
  const popups: string[] = [];
  context.on('page', child => popups.push(child.url()));
  await page.route('**/rest/v1/**', r => r.fulfill({json: new URL(r.request().url()).pathname.endsWith('/profiles') ? {display_name:'Fixture',role:'student',active:true} : []}));
  await page.route('**/auth/v1/token?grant_type=password', r => r.fulfill({json: {access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:4000000000,expires_in:3600,token_type:'bearer',user:{id:uid,aud:'authenticated',app_metadata:{},user_metadata:{}}}}));
  await page.goto('/'+query);
  await expect(page.getByRole('heading',{name:'Team sign in',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Continue to scanned inventory location'})).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`inventory_location=${id}$`));
  await page.getByLabel('Email',{exact:true}).fill('fixture@example.invalid');
  await page.getByLabel('Password',{exact:true}).fill('fixture-only-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  const link = page.getByRole('link',{name:'Continue to scanned inventory location',exact:true});
  await expect(link).toHaveAttribute('href',target);
  expect(popups).toEqual([]);
  expect(new URL(page.url()).search).toBe(query);
  await page.reload();
  await expect(link).toHaveAttribute('href',target);
  expect(new URL(page.url()).search).toBe(query);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
});

test('normal gateway and malformed/external return values never show a return link', async ({page}) => {
  await session(page);
  for (const route of ['/', '/?inventory_location=https%3A%2F%2Fevil.invalid%2F', '/?return_to=https://evil.invalid', '/'+query+'&inventory_location='+id]) {
    await page.goto(route);
    await expect(page.locator('.suite-header')).toBeVisible();
    await expect(page.getByRole('link',{name:'Continue to scanned inventory location'})).toHaveCount(0);
  }
});
