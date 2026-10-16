import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from './scanner';

test('discovers only drawing names without parsing contents or traversing dependencies and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'exact-scan-'));
  try {
    for (const folder of ['notes', 'node_modules/package', '.git', 'dist']) await mkdir(join(root, folder), { recursive: true });
    for (const file of ['a.excalidraw', 'notes/b.excalidraw', 'notes/note.md', 'notes/c.excalidraw.md', 'node_modules/package/no.excalidraw', '.git/no.excalidraw', 'dist/no.excalidraw']) await writeFile(join(root, file), 'not parsed');
    await symlink(root, join(root, 'notes/cycle'));
    const paths: string[] = [];
    await scan(root, batch => paths.push(...batch));
    expect(paths.sort()).toEqual([join(root, 'a.excalidraw'), join(root, 'notes/b.excalidraw')]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
