import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Documents } from './files';

const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const scene = (name: string) => ({ type: 'excalidraw', version: 2, source: 'test', elements: [], appState: { name }, files: {}, custom: 'preserved' });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'exact-draw-'));
  directories.push(dir);
  const path = join(dir, 'drawing.excalidraw');
  await writeFile(path, JSON.stringify(scene('first')));
  return { dir, path, documents: new Documents(join(dir, 'recovery')) };
}

test('saves a loaded version, preserves unknown metadata, and refuses an external replacement', async () => {
  const { dir, path, documents } = await fixture();
  const loaded = await documents.read(path);
  const saved = await documents.save(path, loaded.version, { ...scene('edited'), custom: undefined });
  expect(JSON.parse(await readFile(path, 'utf8')).custom).toBe('preserved');
  expect(saved.version).not.toBe(loaded.version);
  const replacement = join(dir, 'replacement');
  await writeFile(replacement, JSON.stringify(scene('agent')));
  await rename(replacement, path);
  await expect(documents.save(path, saved.version, scene('stale'))).rejects.toMatchObject({ status: 409 });
  expect(JSON.parse(await readFile(path, 'utf8')).appState.name).toBe('agent');
});

test('rejects other file formats and incomplete external writes without replacing them', async () => {
  const { dir, path, documents } = await fixture();
  const loaded = await documents.read(path);
  const md = join(dir, 'drawing.excalidraw.md');
  await writeFile(md, JSON.stringify(scene('markdown')));
  await expect(documents.read(md)).rejects.toThrow('.excalidraw');
  await writeFile(path, '{"type":');
  await expect(documents.read(path)).rejects.toThrow();
  await expect(documents.save(path, loaded.version, scene('stale'))).rejects.toThrow();
  expect(await readFile(path, 'utf8')).toBe('{"type":');
});

test('serializes saves and keeps a recovery file for the previous disk version', async () => {
  const { path, documents } = await fixture();
  const loaded = await documents.read(path);
  const results = await Promise.allSettled([
    documents.save(path, loaded.version, scene('one')),
    documents.save(path, loaded.version, scene('two')),
  ]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const recovery = await documents.recover(path, scene('unsaved'));
  expect(JSON.parse(await readFile(recovery, 'utf8')).appState.name).toBe('unsaved');
});
