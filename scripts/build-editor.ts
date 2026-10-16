import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const outdir = join(root, 'dist/editor');
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [join(root, 'editor/main.tsx')],
  outdir,
  target: 'browser',
  format: 'esm',
  splitting: true,
  minify: true,
  publicPath: '/assets/',
  naming: { entry: '[name].[ext]', chunk: '[name]-[hash].[ext]', asset: '[name]-[hash].[ext]' },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  conditions: ['production'],
});
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
await cp(join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts'), join(outdir, 'fonts'), { recursive: true });
await cp(join(root, 'node_modules/@excalidraw/excalidraw/dist/prod/index.css'), join(outdir, 'excalidraw.css'));
await Bun.write(join(outdir, 'index.html'), `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Exact Draw</title><link rel="stylesheet" href="/assets/excalidraw.css"><link rel="stylesheet" href="/assets/main.css"><script>window.EXCALIDRAW_ASSET_PATH = '/assets/';</script></head><body><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>`);
console.log('Built the local Excalidraw editor and bundled fonts.');
