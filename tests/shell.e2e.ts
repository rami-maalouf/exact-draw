import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createShellFixture } from './shell-fixture';

const fixture = await createShellFixture();
const root = join(fixture.dataDirectory, 'drawings');
const app = fixture.app;
await mkdir(root);
const file = join(root, 'First.excalidraw');
const otherFolder = join(root, 'Other');
await mkdir(otherFolder);
await writeFile(file, JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }));
await writeFile(join(root, 'Unopened.excalidraw'), JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }));
await writeFile(join(root, 'hidden.excalidraw.md'), 'not a supported drawing');
await fixture.service.open(file);
await fixture.service.open(root);
await fixture.service.open(otherFolder);
await fixture.restart();
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
  type "toggle-sidebar" key "Meta+b"
  clock settle
  expect tree missing "sidebar"
  expect tree has "drawing-actions"
  tap "drawing-actions"
  clock settle
  expect tree has "drawing-history"
  expect tree has "drawing-reopen"
  expect tree has "drawing-trash-list"
  tap "drawing-actions"
  clock settle
  type "toggle-sidebar" key "Meta+b"
  clock settle
`);
try {
  for (const host of process.argv.slice(2).length ? process.argv.slice(2) : ['web', 'macos']) {
    await fixture.service.open(root);
    if (host === 'macos') await fixture.buildNative();
    await fixture.run(['exact.mjs', 'test', host, testPath]);
  }
} finally { await fixture.dispose(Bun.env.EXACT_KEEP_SHELL_FIXTURE === '1'); }
