import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Documents } from './files';

const directories: string[] = [];
const stores: Documents[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close?.();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const scene = (name: string) => ({ type: 'excalidraw' as const, version: 2, elements: [], appState: { name }, files: {}, custom: 'preserved' });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'exact-history-'));
  directories.push(directory);
  const recovery = join(directory, 'recovery');
  const documents = new Documents(recovery);
  stores.push(documents);
  return { directory, recovery, documents, path: join(directory, 'drawing.excalidraw') };
}

test('creates exclusively, duplicates independently, and retains identity and history through move, trash and restore', async () => {
  const { directory, documents, path } = await fixture();
  const created = await documents.create(path, scene('original'));
  await expect(documents.create(path, scene('overwrite'))).rejects.toThrow();
  const copy = await documents.duplicate(path, created.version, join(directory, 'copy.excalidraw'));
  expect(copy.id).not.toBe(created.id);
  await expect(documents.move(path, created.version, copy.path)).rejects.toThrow();
  const moved = await documents.move(path, created.version, join(directory, 'renamed.excalidraw'));
  expect(moved.id).toBe(created.id);
  await expect(readFile(path)).rejects.toThrow();
  await documents.trash(moved.path, moved.version);
  expect((await documents.listTrash())[0]).toMatchObject({ id: created.id, path: moved.path });
  await writeFile(moved.path, JSON.stringify(scene('other')));
  await expect(documents.restoreTrash(created.id)).rejects.toThrow();
  const restored = await documents.restoreTrash(created.id, path);
  expect(restored.id).toBe(created.id);
  expect(restored.document.appState.name).toBe('original');
  expect(await documents.listTrash()).toEqual([]);
  expect(await documents.history(path)).toHaveLength(1);
});

test('history persists across restart, records external revisions and previews without changing the current file', async () => {
  const { documents, path, recovery } = await fixture();
  const created = await documents.create(path, scene('first'));
  await documents.save(path, created.version, scene('second'));
  await writeFile(path, JSON.stringify(scene('external')));
  const external = await documents.read(path);
  await documents.read(path);
  const history = await documents.history(path);
  expect(history.map(item => item.source)).toEqual(['external', 'save', 'create']);
  const preview = await documents.preview(path, history[2]!.id);
  expect(preview.document.appState.name).toBe('first');
  expect((await documents.read(path)).version).toBe(external.version);
  documents.close();
  const reopened = new Documents(recovery);
  stores.push(reopened);
  expect((await reopened.read(path)).id).toBe(created.id);
  expect(await reopened.history(path)).toEqual(history);
});

test('restoring records a new revision and preserves the content replaced, rejecting stale versions', async () => {
  const { documents, path } = await fixture();
  const first = await documents.create(path, scene('first'));
  const initial = (await documents.history(path))[0]!;
  const second = await documents.save(path, first.version, scene('second'));
  await expect(documents.restore(path, first.version, initial.id)).rejects.toMatchObject({ status: 409 });
  const restored = await documents.restore(path, second.version, initial.id);
  expect(restored.document.appState.name).toBe('first');
  const history = await documents.history(path);
  expect(history.map(item => item.source)).toEqual(['restore', 'save', 'create']);
  expect((await documents.preview(path, history[1]!.id)).document.appState.name).toBe('second');
  await documents.checkpoint(path, restored.version);
  expect((await documents.history(path))[0]?.source).toBe('checkpoint');
});

test('retention keeps the latest fifty revisions and cannot preview another document history', async () => {
  const { documents, path, directory } = await fixture();
  let current = await documents.create(path, scene('first'));
  const initial = (await documents.history(path))[0]!;
  const other = await documents.create(join(directory, 'other.excalidraw'), scene('other'));
  await expect(documents.preview(other.path, initial.id)).rejects.toThrow();
  for (let index = 0; index < 55; index++) current = await documents.save(path, current.version, scene(String(index)));
  expect(await documents.history(path)).toHaveLength(50);
  await expect(documents.preview(path, initial.id)).rejects.toThrow();
});

test('stale lifecycle actions never move, trash, or duplicate externally changed content', async () => {
  const { documents, path, directory } = await fixture();
  const created = await documents.create(path, scene('first'));
  await writeFile(path, JSON.stringify(scene('external')));
  await expect(documents.move(path, created.version, join(directory, 'moved.excalidraw'))).rejects.toMatchObject({ status: 409 });
  await expect(documents.trash(path, created.version)).rejects.toMatchObject({ status: 409 });
  await expect(documents.duplicate(path, created.version, join(directory, 'copy.excalidraw'))).rejects.toMatchObject({ status: 409 });
  expect(JSON.parse(await readFile(path, 'utf8')).appState.name).toBe('external');
  expect(await documents.listTrash()).toEqual([]);
});

test('same-byte reads and saves do not fill history; explicit checkpoints do', async () => {
  const { documents, path } = await fixture();
  const created = await documents.create(path, scene('first'));
  await documents.read(path);
  await documents.save(path, created.version, created.document);
  expect(await documents.history(path)).toHaveLength(1);
  await documents.checkpoint(path, created.version);
  await documents.checkpoint(path, created.version);
  expect((await documents.history(path)).map(item => item.source)).toEqual(['checkpoint', 'checkpoint', 'create']);
});

test('restart rolls back an interrupted move before source removal and finalizes one after removal', async () => {
  const { History } = await import('./history');
  const { link, unlink } = await import('node:fs/promises');
  for (const sourceRemoved of [false, true]) {
    const { documents, path, directory, recovery } = await fixture();
    const created = await documents.create(path, scene('original'));
    const revision = (await documents.history(path))[0]!;
    documents.close();
    const destination = join(dirname(created.path), 'moved.excalidraw');
    const temporary = `${destination}.interrupted.tmp`;
    const history = new History(recovery);
    history.begin({ id: created.id, source: created.path, destination, temporary, version: created.version, kind: 'move', deletedAt: null });
    await writeFile(temporary, await readFile(path));
    await link(temporary, destination);
    if (sourceRemoved) await unlink(path);
    history.close();
    const reopened = new Documents(recovery);
    stores.push(reopened);
    const current = await reopened.read(sourceRemoved ? destination : path);
    expect(current.id).toBe(created.id);
    expect((await reopened.history(current.path))[0]!.id).toBe(revision.id);
    await expect(readFile(sourceRemoved ? path : destination)).rejects.toThrow();
    await expect(readFile(temporary)).rejects.toThrow();
  }
});

test('interrupted destination collision never removes an existing file or the source', async () => {
  const { History } = await import('./history');
  const { documents, path, directory, recovery } = await fixture();
  const created = await documents.create(path, scene('original'));
  documents.close();
  const destination = join(directory, 'occupied.excalidraw');
  const temporary = `${destination}.interrupted.tmp`;
  await writeFile(destination, await readFile(path));
  await writeFile(temporary, await readFile(path));
  const history = new History(recovery);
  history.begin({ id: created.id, source: created.path, destination, temporary, version: created.version, kind: 'move', deletedAt: null });
  history.close();
  const reopened = new Documents(recovery);
  stores.push(reopened);
  expect((await reopened.read(path)).id).toBe(created.id);
  expect((await reopened.read(destination)).id).not.toBe(created.id);
  expect(await readFile(path, 'utf8')).toBe(await readFile(destination, 'utf8'));
});

test('interrupted move preserves the original when another file replaces its old path', async () => {
  const { History } = await import('./history');
  const { link, unlink } = await import('node:fs/promises');
  const { documents, path, recovery } = await fixture();
  const created = await documents.create(path, scene('original'));
  documents.close();
  const destination = join(dirname(created.path), 'moved.excalidraw');
  const temporary = `${destination}.interrupted.tmp`;
  const history = new History(recovery);
  history.begin({ id: created.id, source: created.path, destination, temporary, version: created.version, kind: 'move', deletedAt: null });
  await writeFile(temporary, await readFile(path));
  await link(temporary, destination);
  await unlink(path);
  await writeFile(path, JSON.stringify(scene('replacement')));
  history.close();
  const reopened = new Documents(recovery);
  stores.push(reopened);
  expect((await reopened.read(destination)).id).toBe(created.id);
  expect((await reopened.read(destination)).document.appState.name).toBe('original');
  expect((await reopened.read(path)).document.appState.name).toBe('replacement');
  expect((await reopened.read(path)).id).not.toBe(created.id);
});

test('interrupted move recovers its intact staging copy after destination replacement', async () => {
  const { History } = await import('./history');
  const { link, unlink, readdir } = await import('node:fs/promises');
  const { documents, path, recovery } = await fixture();
  const created = await documents.create(path, scene('original'));
  documents.close();
  const destination = join(dirname(created.path), 'moved.excalidraw');
  const temporary = `${destination}.interrupted.tmp`;
  const history = new History(recovery);
  history.begin({ id: created.id, source: created.path, destination, temporary, version: created.version, kind: 'move', deletedAt: null });
  await writeFile(temporary, await readFile(path));
  await link(temporary, destination);
  await unlink(path);
  await unlink(destination);
  await writeFile(destination, JSON.stringify(scene('replacement')));
  history.close();
  const reopened = new Documents(recovery);
  stores.push(reopened);
  expect((await reopened.read(destination)).document.appState.name).toBe('replacement');
  const recoveredName = (await readdir(recovery)).find(name => name.startsWith('interrupted-move-'))!;
  const recovered = await reopened.read(join(recovery, recoveredName));
  expect(recovered.id).toBe(created.id);
  expect(recovered.document.appState.name).toBe('original');
});
