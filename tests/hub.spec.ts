import {session} from './hub-session';
import { test, expect } from "@playwright/test";
import { resources, systems } from "../src/links";
for (const width of [390, 768, 1280, 1440])
  test(`launcher and layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await session(page);await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    if(width<761)await page.getByRole('button',{name:'Hub menu'}).click();
    const nav=page.getByRole('navigation',{name:'Hub workspace'});
    await expect(nav).toBeVisible();
    await expect(page.getByRole('heading',{name:'Quick access',exact:true})).toHaveCount(0);
    await expect(nav.getByRole('link',{name:'Team Management',exact:true})).toHaveCount(0);
    for(const link of systems){const a=nav.getByRole('link',{name:link.name,exact:true});await expect(a).toHaveAttribute('href',link.url!);}
    for(const link of resources){if(link.url){const a=nav.getByRole('link',{name:link.name,exact:true});await expect(a).toHaveAttribute('href',link.url);await expect(a).toHaveAttribute('rel','noopener noreferrer');}else await expect(nav.getByText(link.name,{exact:true})).toHaveCount(0);}
    if(width<761){await page.keyboard.press('Escape');await expect(nav).toBeHidden();await expect(page.getByRole('button',{name:'Hub menu'})).toBeFocused();}
    expect(
      await page.evaluate(() => document.body.scrollWidth <= innerWidth),
    ).toBe(true);
    expect(
      await page
        .locator("img")
        .evaluateAll((imgs) =>
          imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0),
        ),
    ).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: `test-results/hub-${width}.png`,
      fullPage: true,
    });
  });
