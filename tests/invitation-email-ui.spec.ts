import {test, expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {invitationPreview, previewURL} from '../supabase/templates/preview-invite.mjs';

for (const width of [320, 390, 1024]) {
  for (const mode of ['standard', 'no-images', 'inline-only'] as const) {
    test(`invitation email layout at ${width}px with ${mode}`, async ({page}, testInfo) => {
      // The preview embeds the checked-in logo. No network or Auth URL is opened.
      await page.route('**/*', route => route.abort());
      await page.setViewportSize({width, height: 900});
      await page.setContent(invitationPreview({images: mode !== 'no-images', inlineStylesOnly: mode === 'inline-only'}));
      await expect(page.getByRole('heading', {name: "You're invited to join us."})).toBeVisible();
      const cta = page.getByRole('link', {name: 'Accept invitation', exact: true});
      await expect(cta).toHaveAttribute('href', previewURL);
      await expect(cta).toBeVisible();
      const box = await cta.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.keyboard.press('Tab');
      await expect(cta).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', {name: previewURL, exact: true})).toBeFocused();
      if (mode === 'standard') {
        await expect.poll(() => page.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBeTruthy();
      }
      mkdirSync('test-results/invite-cleanup', {recursive: true});
      const screenshot = await page.screenshot({path: `test-results/invite-cleanup/email-${width}-${mode}.png`, fullPage: true});
      await testInfo.attach('Synthetic invitation preview', {body: screenshot, contentType: 'image/png'});
    });
  }
}
