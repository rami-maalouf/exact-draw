import { resolve } from 'node:path';
import { startService } from '../service/server';
const root = resolve(import.meta.dir, '..');
let activeChild: ReturnType<typeof Bun.spawn> | undefined;
const run = async (args: string[], executable = process.execPath) => {
  const child = Bun.spawn([executable, ...args], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
  activeChild = child;
  const code = await child.exited;
  activeChild = undefined;
  if (code) throw new Error(`Command failed (${code}): ${args.join(' ')}`);
};
await run(['scripts/build-editor.ts']);
const web = process.argv.includes('--web');
const service = await startService({ allowedOrigins: web ? ['http://127.0.0.1:8765'] : [] });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { activeChild?.kill(signal); service.stop(); process.exit(); });
console.log('Local file service ready. Keep this launcher running while using Exact Draw.');
try {
  if (web) await run(['exact.mjs', 'web', '--port', '8765']);
  else {
    await run(['exact.mjs', 'mac', '--bundle']);
    process.env.EXACT_APP_DIR = root;
    const sdk = resolve(root, process.env.EXACT2 ?? '../exact2');
    const { resolveApp } = await import(resolve(sdk, 'scripts/app.mjs'));
    const { appleArtifacts } = await import(resolve(sdk, 'host/apple/build.mjs'));
    const artifact = appleArtifacts(resolveApp());
    await run([], resolve(artifact.bundle, 'Contents/MacOS', artifact.executable));
  }
} finally { service.stop(); }
