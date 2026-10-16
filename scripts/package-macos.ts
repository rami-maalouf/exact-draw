import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const outdir = resolve(root, 'native-server');
async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  if (await child.exited) throw new Error(`Failed: ${args.join(' ')}`);
}
await run(['scripts/build-editor.ts']);
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [resolve(root, 'service/desktop.ts'), resolve(root, 'service/scan-worker.ts')],
  outdir, target: 'bun', format: 'esm', naming: '[name].js',
});
if (!result.success) throw new Error(result.logs.map(String).join('\n'));
await cp(process.execPath, resolve(outdir, 'bun'));
await cp(resolve(root, 'dist/editor'), resolve(outdir, 'editor'), { recursive: true });
if (!process.argv.includes('--resources-only')) {
  await run(['exact.mjs', 'mac', '--bundle']);
  console.log('Standalone app built with its runtime, file service, editor, fonts, and app icon.');
}
