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
    await expect(
      page.getByRole("heading", { name: "Quick access", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Team tools", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".my-quick a")).toHaveText(["Inventory →", "Pit Operations →", "Attendance →", "Finance →"]);
    await expect(page.locator(".attendance-section")).toHaveCount(0);
    await expect(page.getByRole("heading", {name:"Administration",exact:true})).toHaveCount(0);
    if(width>=768) expect(await page.locator(".my-quick>div").evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(" ").length)).toBe(4);
    for (const link of systems) {
      const a = page.locator('.my-quick').getByRole('link',{name:link.name,exact:true});
      await expect(a).toHaveAttribute("href", link.url!);
      await expect(a).not.toHaveAttribute("target", "_blank");
    }
    for (const link of resources) {
      const card = page.locator('.my-tools>div').locator(link.url?'a':'span').filter({hasText:link.name});
      if (link.url) {
        await expect(card).toHaveAttribute("href", link.url);
        await expect(card).toHaveAttribute("target", "_blank");
        await expect(card).toHaveAttribute("rel", "noopener noreferrer");
      } else {
        await expect(card).not.toHaveAttribute("href");
        await expect(card.getByText("Not set up")).toBeVisible();
      }
    }
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
