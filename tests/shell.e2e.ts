import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startService } from '../service/server';

const root = await realpath(await mkdtemp(join(tmpdir(), 'draw-shell-')));
const app = resolve(import.meta.dir, '..');
const file = join(root, 'First.excalidraw');
const otherFolder = join(root, 'Other');
await mkdir(otherFolder);
await writeFile(file, JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }));
await writeFile(join(root, 'Unopened.excalidraw'), JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }));
await writeFile(join(root, 'hidden.excalidraw.md'), 'not a supported drawing');
const options = { port: 47931, stateDirectory: join(root, 'state'), testLoopbackOrigins: true };
let service = await startService(options);
await service.open(file);
await service.open(root);
await service.open(otherFolder);
service.stop();
service = await startService(options);
const testPath = join(app, '.exact/shell.test.contract');
await mkdir(join(app, '.exact'), { recursive: true });
await writeFile(testPath, `test "restore the saved folder and open its drawing without a path field"
  size 1280x820
  clock data
  expect tree missing "path"
  expect tree missing "open"
  expect tree missing ${JSON.stringify(`recent-${encodeURIComponent(root)}`)}
  expect tree missing ${JSON.stringify(`recent-${encodeURIComponent(otherFolder)}`)}
  expect text "recent-heading" == "Recent (1)"
  expect tree has ${JSON.stringify(`entry-${encodeURIComponent(root)}`)}
  tap ${JSON.stringify(`recent-${encodeURIComponent(file)}`)}
  clock data
  expect text "active-name" == "First"
  reload
  clock data
  expect tree has ${JSON.stringify(`recent-${encodeURIComponent(file)}`)}
  expect tree has ${JSON.stringify(`entry-${encodeURIComponent(root)}`)}
  clock data
  expect text "active-name" == "First"
  clock +2000
  clock data
  type "search" "First"
  clock data
  expect tree has ${JSON.stringify(`entry-${encodeURIComponent(root)}--${encodeURIComponent(file)}`)}
  expect text "scan-status" == "2 drawings"
  expect text "recent-heading" == "Recent (1)"
  tap ${JSON.stringify(`entry-${encodeURIComponent(root)}`)} contextmenu
  expect tree has "remove-workspace-folder"
  tap "remove-workspace-folder"
  clock data
  expect tree missing ${JSON.stringify(`entry-${encodeURIComponent(root)}`)}
  expect tree has ${JSON.stringify(`entry-${encodeURIComponent(otherFolder)}`)}
  expect text "active-name" == "First"
`);
try {
  for (const host of process.argv.slice(2).length ? process.argv.slice(2) : ['web', 'macos']) {
    await service.open(root);
    const child = Bun.spawn([process.execPath, 'exact.mjs', 'test', host, testPath], { cwd: app, stdout: 'inherit', stderr: 'inherit', env: { ...Bun.env, CHROME: Bun.env.CHROME ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' } });
    const code = await child.exited;
    if (code) throw new Error(`${host} shell test failed (${code})`);
  }
} finally { service.stop(); await rm(root, { recursive: true, force: true }); }
