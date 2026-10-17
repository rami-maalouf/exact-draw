import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from './server';

test('creates, checkpoints, renames, restores, closes, reopens and recovers a trashed drawing through the API', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'draw-lifecycle-')));
  const options = { port: 0, stateDirectory: join(root, 'state') };
  let service = await startService(options);
  const call = async (route: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${service.server.port}${route}`, {
      headers: { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const path = join(root, 'First.excalidraw');
    const created = await call('/api/lifecycle', { action: 'new', destination: path });
    expect(created.status).toBe(200);
    let snapshot = (await call('/api/document')).data.snapshot;
    const id = snapshot.id;
    snapshot = (await call('/api/save', { path, version: snapshot.version, document: { ...snapshot.document, appState: { viewBackgroundColor: '#abcdef' } } })).data;
    const history = (await call(`/api/history?path=${encodeURIComponent(path)}`)).data.entries;
    expect(history.length).toBeGreaterThanOrEqual(2);
    const original = history[history.length - 1];
    const renamed = join(root, 'Renamed.excalidraw');
    expect((await call('/api/lifecycle', { action: 'rename', path, version: snapshot.version, name: 'Renamed' })).status).toBe(200);
    snapshot = (await call('/api/document')).data.snapshot;
    expect(snapshot.path).toBe(renamed);
    expect(snapshot.id).toBe(id);
    expect((await call('/api/workspace')).data.recent.some((entry: { path: string }) => entry.path === path)).toBe(false);
    expect((await call('/api/lifecycle', { action: 'restore-history', path: renamed, version: snapshot.version, checkpointId: original.id })).status).toBe(200);
    snapshot = (await call('/api/document')).data.snapshot;
    expect(snapshot.document.appState.viewBackgroundColor).not.toBe('#abcdef');
    expect((await call(`/api/history?path=${encodeURIComponent(renamed)}`)).data.entries[0].source).toBe('restore');
    expect((await call('/api/lifecycle', { action: 'close', path: renamed, version: snapshot.version })).status).toBe(200);
    expect((await call('/api/document')).data.snapshot).toBeNull();
    expect((await call('/api/lifecycle', { action: 'reopen' })).status).toBe(200);
    snapshot = (await call('/api/document')).data.snapshot;
    expect(snapshot.id).toBe(id);
    expect((await call('/api/lifecycle', { action: 'trash', path: renamed, version: snapshot.version })).status).toBe(200);
    expect(await Bun.file(renamed).exists()).toBe(false);
    service.stop(); service = await startService(options);
    const trash = (await call('/api/trash')).data.entries;
    expect(trash[0].id).toBe(id);
    expect((await call('/api/lifecycle', { action: 'restore-trash', id })).status).toBe(200);
    expect((await call('/api/document')).data.snapshot.id).toBe(id);
    expect((await call('/api/trash')).data.entries).toEqual([]);
    const restoredBytes = await readFile(renamed, 'utf8');
    await writeFile(renamed, restoredBytes.replace('excalidraw', 'invalid'));
    expect((await call('/api/lifecycle', { action: 'trash', path: renamed, version: snapshot.version })).status).not.toBe(200);
    expect(await Bun.file(renamed).exists()).toBe(true);
  } finally { service.stop(); await rm(root, { recursive: true, force: true }); }
});

test('queues native commands without changing the active file before the editor flushes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'draw-command-')));
  const service = await startService({ port: 0, stateDirectory: join(root, 'state') });
  const call = async (route: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${service.server.port}${route}`, { method: 'POST', headers: { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  try {
    expect((await call('/api/command', { action: 'new', destination: join(root, 'New.excalidraw') })).status).toBe(200);
    expect(await Bun.file(join(root, 'New.excalidraw')).exists()).toBe(false);
    expect((await call('/api/command', { action: 'close' })).status).toBe(409);
    expect((await call('/api/command/take', {})).data.command.action).toBe('new');
    expect((await call('/api/command/take', {})).data.command).toBeNull();
  } finally { service.stop(); await rm(root, { recursive: true, force: true }); }
});

test('keeps completed file actions active when recent or reopen state cannot be persisted', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'draw-state-failure-')));
  const stateDirectory = join(root, 'state');
  const service = await startService({ port: 0, stateDirectory });
  const call = async (route: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${service.server.port}${route}`, {
      headers: { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    const created = await call('/api/lifecycle', { action: 'new', destination: join(root, 'First.excalidraw') });
    const first = created.data.snapshot;
    await mkdir(join(stateDirectory, 'recent.json.tmp'));
    await mkdir(join(stateDirectory, 'document-session.json.tmp'));
    const moved = await call('/api/lifecycle', { action: 'rename', path: first.path, version: first.version, name: 'Moved' });
    expect(moved.status).toBe(200);
    const current = (await call('/api/document')).data;
    expect(current.snapshot.path).toBe(join(root, 'Moved.excalidraw'));
    expect(current.snapshot.id).toBe(first.id);
    expect(current.error).toBe('');
    expect(await Bun.file(first.path).exists()).toBe(false);
    expect(await Bun.file(current.snapshot.path).exists()).toBe(true);
    expect((await call('/api/workspace')).data.error).toContain('drawing action completed');
    const trashed = await call('/api/lifecycle', { action: 'trash', path: current.snapshot.path, version: current.snapshot.version });
    expect(trashed.status).toBe(200);
    expect((await call('/api/document')).data.snapshot).toBeNull();
    expect((await call('/api/trash')).data.entries[0].id).toBe(first.id);
    await rm(join(stateDirectory, 'recent.json.tmp'), { recursive: true });
    await rm(join(stateDirectory, 'document-session.json.tmp'), { recursive: true });
    expect((await call('/api/lifecycle', { action: 'restore-trash', id: first.id })).status).toBe(200);
    expect((await call('/api/workspace')).data.error).toBe('');
    expect(JSON.parse(await readFile(join(stateDirectory, 'document-session.json'), 'utf8')).activePath).toBe(current.snapshot.path);
  } finally { await service.stop(); await rm(root, { recursive: true, force: true }); }
});
