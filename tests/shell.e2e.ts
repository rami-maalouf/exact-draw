import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startService } from '../service/server';

const root = await realpath(await mkdtemp(join(tmpdir(), 'draw-shell-')));
const app = resolve(import.meta.dir, '..');
const file = join(root, 'First.excalidraw');
await writeFile(file, JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }));
await writeFile(join(root, 'hidden.excalidraw.md'), 'not a supported drawing');
const service = await startService({ port: 47931, stateDirectory: join(root, 'state'), testLoopbackOrigins: true });
const testPath = join(app, '.exact/shell.test.contract');
await mkdir(join(app, '.exact'), { recursive: true });
await writeFile(testPath, `test "open a file, keep recent locations, and discover its folder without changing the editor"
  size 1280x820
  clock data
  type "path" ${JSON.stringify(file)}
  tap "open"
  clock data
  expect text "active-name" == "First.excalidraw"
  reload
  clock data
  expect tree has ${JSON.stringify(`recent-${file}`)}
  type "path" ${JSON.stringify(root)}
  tap "open"
  clock data
  expect text "active-name" == "First.excalidraw"
  clock +2000
  clock data
  type "search" "First"
  clock data
  expect tree has ${JSON.stringify(`entry-${file}`)}
  expect text "scan-status" == "1 drawing"
`);
try {
  for (const host of process.argv.slice(2).length ? process.argv.slice(2) : ['web', 'macos']) {
    const child = Bun.spawn([process.execPath, 'exact.mjs', 'test', host, testPath], { cwd: app, stdout: 'inherit', stderr: 'inherit', env: { ...Bun.env, CHROME: Bun.env.CHROME ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' } });
    const code = await child.exited;
    if (code) throw new Error(`${host} shell test failed (${code})`);
  }
} finally { service.stop(); await rm(root, { recursive: true, force: true }); }
