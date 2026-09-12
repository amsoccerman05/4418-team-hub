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
      page.getByRole("heading", { name: "4418 Systems", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Team Resources", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".system-card h3")).toHaveText(["Inventory", "Pit Operations", "Attendance", "Finance"]);
    await expect(page.locator(".attendance-section")).toHaveCount(0);
    await expect(page.getByRole("heading", {name:"Administration",exact:true})).toHaveCount(0);
    if(width>=768) expect(await page.locator(".systems-grid").evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(" ").length)).toBe(2);
    for (const link of systems) {
      const a = page
        .locator(".system-card")
        .filter({
          has: page.getByRole("heading", { name: link.name, exact: true }),
        });
      await expect(a).toHaveAttribute("href", link.url!);
      await expect(a).not.toHaveAttribute("target", "_blank");
    }
    for (const link of resources) {
      const card = page
        .locator(".resource-card")
        .filter({
          has: page.getByRole("heading", { name: link.name, exact: true }),
        });
      if (link.url) {
        await expect(card).toHaveAttribute("href", link.url);
        await expect(card).toHaveAttribute("target", "_blank");
        await expect(card).toHaveAttribute("rel", "noopener noreferrer");
      } else {
        await expect(card).not.toHaveAttribute("href");
        await expect(card.getByText("Link not configured")).toBeVisible();
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
