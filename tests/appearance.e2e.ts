import { chromium, expect } from '@playwright/test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startService } from '../service/server';

const app = resolve(import.meta.dir, '..');
const root = await realpath(await mkdtemp(join(tmpdir(), 'exact-appearance-')));
const file = join(root, 'Colors.excalidraw');
const drawing = (color: string) => JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: { viewBackgroundColor: color }, files: {} });
await writeFile(file, drawing('#ffffff'));
const service = await startService({ port: 47931, stateDirectory: join(root, 'state'), testLoopbackOrigins: true });
await service.open(root);
const build = Bun.spawn([process.execPath, 'exact.mjs', 'web-build'], { cwd: app, stdout: 'inherit', stderr: 'inherit' });
if (await build.exited) { service.stop(); throw new Error('Could not build the shell'); }
const shell = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  return new Response(Bun.file(join(app, 'target/web-dist', path === '/' ? 'index.html' : path)));
} });
const port = shell.port;
const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
try {
  await expect.poll(async () => { try { return (await (await fetch(`http://127.0.0.1:${port}`)).text()).includes('<title>Exact Draw</title>'); } catch { return false; } }, { timeout: 30000 }).toBe(true);
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, colorScheme: 'dark' });
  await page.goto(`http://127.0.0.1:${port}`);
  const header = page.getByTestId('window-header');
  const sidebar = page.getByTestId('sidebar');
  await expect(header).toHaveCSS('background-color', 'rgb(251, 252, 250)');
  await expect(sidebar).toHaveCSS('background-color', 'rgb(251, 252, 250)');
  await service.open(file);
  const frame = page.frameLocator('[data-testid="drawing-editor"]');
  await expect(frame.getByTestId('active-path')).toHaveText(file);

  async function assertMatchingCanvas(scheme: string) {
    await expect(page.getByTestId('app')).toHaveCSS('color-scheme', scheme);
    const canvas = frame.locator('canvas.excalidraw__canvas.static');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    // a screenshot samples the composited css filter, not the raw canvas buffer.
    await expect.poll(async () => {
      const bytes = await page.screenshot({ clip: { x: box.x + 600, y: box.y + 400, width: 1, height: 1 } });
      const pixel = await page.evaluate(async base64 => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const sample = document.createElement('canvas');
        sample.width = sample.height = 1;
        const context = sample.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      }, bytes.toString('base64'));
      const color = await header.evaluate(element => getComputedStyle(element).backgroundColor);
      const channels = color.match(/\d+/g)!.map(Number);
      return Math.max(...pixel.map((channel, index) => Math.abs(channel - channels[index])));
    }).toBeLessThanOrEqual(1);
    await expect(sidebar).toHaveCSS('background-color', await header.evaluate(element => getComputedStyle(element).backgroundColor));
  }
  await expect(header).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await assertMatchingCanvas('light');
  await frame.getByTestId('main-menu-trigger').click();
  await frame.getByTestId('toggle-dark-mode').click();
  await assertMatchingCanvas('dark');
  await frame.getByTestId('toggle-dark-mode').click();
  await assertMatchingCanvas('light');
  await page.keyboard.press('Escape');
  for (const color of ['#fff3bf', '#1e1e1e', '#e3fafc']) {
    await writeFile(file, drawing(color));
    await service.sync();
    await expect.poll(() => header.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(255, 255, 255)');
    await expect.poll(() => frame.locator('canvas.excalidraw__canvas.static').evaluate((canvas: HTMLCanvasElement) => {
      const rgb = canvas.getContext('2d')!.getImageData(600, 400, 1, 1).data;
      return `#${Array.from(rgb).slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')}`;
    })).toBe(color);
    await assertMatchingCanvas(color === '#1e1e1e' ? 'dark' : 'light');
  }
  await frame.getByTestId('main-menu-trigger').click();
  await frame.getByTestId('toggle-dark-mode').click();
  await assertMatchingCanvas('dark');
  console.log('PASS: empty, white, dark, custom, external-update, and filtered custom backgrounds match the shell');
} finally {
  await browser.close();
  shell.stop(true);
  service.stop();
  await rm(root, { recursive: true, force: true });
}
