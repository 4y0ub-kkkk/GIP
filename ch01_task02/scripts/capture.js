import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

// Start `npm run dev` first. These are real screenshots of the running UI.
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    (existsSync('/usr/bin/google-chrome')
      ? '/usr/bin/google-chrome'
      : undefined),
});
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1140 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });
  await page.goto(`http://127.0.0.1:${process.env.PORT ?? 5173}`, {
    waitUntil: 'networkidle',
  });
  await page.evaluate(() => document.fonts.ready);
  for (const expression of ['(128 + 64) × 2', '2400 × 15%', '2 + 3 × 4']) {
    await page.locator('#expression').fill(expression);
    await page.locator('#expression').press('Enter');
  }
  await page.locator('#expression').blur();
  await page.screenshot({
    path: new URL('../docs/preview.png', import.meta.url).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  await page.locator('#theme-toggle').click();
  await page.screenshot({
    path: new URL('../docs/preview-dark.png', import.meta.url).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  await page.locator('#theme-toggle').click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: new URL('../docs/preview-mobile.png', import.meta.url).pathname,
    fullPage: true,
    animations: 'disabled',
  });
  console.log('Saved desktop, dark theme, and mobile previews in docs/.');
} finally {
  await browser.close();
}
