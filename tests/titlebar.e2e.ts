import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../service/server';

const root = await mkdtemp(join(tmpdir(), 'exact-titlebar-'));
const path = join(root, 'Drawing.excalidraw');
const drawing = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} });
await writeFile(path, drawing);
const service = await startService({ port: 0, stateDirectory: join(root, 'state') });
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
try {
  await service.open(path);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${service.server.port}/editor?token=${service.token}&titlebar=overlay`);
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  for (const width of [1200, 760, 390]) {
    await page.setViewportSize({ width, height: 820 });
    await expect.poll(async () => {
      const box = await page.locator('canvas.interactive').boundingBox();
      return box && { y: box.y, bottom: box.y + box.height, width: box.width };
    }).toEqual({ y: 0, bottom: 820, width });
    const toolbar = page.locator(width < 730 ? '.App-top-bar' : '.App-menu_top');
    await expect(toolbar).toBeVisible();
    expect((await toolbar.boundingBox())!.y).toBeGreaterThanOrEqual(32);
  }
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.getByRole('checkbox', { name: 'Library', exact: true }).locator('..').click();
  await expect(page.locator('.sidebar')).toBeVisible();
  expect((await page.locator('.sidebar').boundingBox())!.y).toBe(32);
  await writeFile(path, '{');
  await service.sync();
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  const warning = (await alert.boundingBox())!;
  expect(warning.y).toBe(32);
  expect((await page.locator('.App-menu_top').boundingBox())!.y).toBeGreaterThanOrEqual(warning.y + warning.height);
  expect((await page.locator('.sidebar').boundingBox())!.y).toBeGreaterThanOrEqual(warning.y + warning.height);
  console.log('PASS: canvas fills the viewport; toolbar, Library, and warnings clear the titlebar at desktop and narrow widths');
} finally {
  await browser.close();
  service.stop();
  await rm(root, { recursive: true, force: true });
}
