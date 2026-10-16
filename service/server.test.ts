import { expect, spyOn, test } from 'bun:test';
import { chmod, mkdtemp, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from './server';
import { Documents } from './files';
const drawing = (color: string) => JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: { viewBackgroundColor: color }, files: {} });

test('serves new disk revisions, scans without replacing the active drawing, and restores recent locations', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'draw-service-')));
  const stateDirectory = join(root, 'state');
  const path = join(root, 'active.excalidraw');
  await writeFile(path, drawing('#ffffff'));
  let service = await startService({ port: 0, stateDirectory });
  const call = (route: string, body?: unknown) => fetch(`http://127.0.0.1:${service.server.port}${route}`, { headers: { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) }).then(r => r.json());
  try {
    await service.open(path);
    const initial = (await call('/api/document')).snapshot;
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules/hidden.excalidraw'), drawing('#000000'));
    await service.open(root);
    const deadline = Date.now() + 3000;
    let workspace = await call('/api/workspace');
    while (workspace.scanning && Date.now() < deadline) { await Bun.sleep(10); workspace = await call('/api/workspace'); }
    expect(workspace.scanning).toBe(false);
    expect(workspace.scanCount).toBe(1);
    expect(workspace.activePath).toBe(path);
    await writeFile(`${path}.new`, drawing('#abcabc'));
    await rename(`${path}.new`, path);
    await service.sync();
    const refreshed = (await call('/api/document')).snapshot;
    expect(refreshed.version).not.toBe(initial.version);
    expect(refreshed.document.appState.viewBackgroundColor).toBe('#abcabc');
    const denied = await fetch(`http://127.0.0.1:${service.server.port}/api/document`);
    expect(denied.status).toBe(401);
    const crossSite = await fetch(`http://127.0.0.1:${service.server.port}/session`, { headers: { origin: 'https://unrelated.example' } });
    expect(crossSite.status).toBe(403);
    const otherLocalApp = await fetch(`http://127.0.0.1:${service.server.port}/session`, { headers: { origin: 'http://127.0.0.1:12345' } });
    expect(otherLocalApp.status).toBe(403);
    service.stop();
    service = await startService({ port: 0, stateDirectory });
    const restored = await call('/api/workspace');
    expect(restored.recent.map((entry: { path: string }) => entry.path)).toEqual([root, path]);
  } finally { service.stop(); await rm(root, { recursive: true, force: true }); }
});

test('a folder enumeration warning does not become an active-document error', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'draw-scan-warning-')));
  const blocked = join(root, 'unreadable');
  await mkdir(blocked); await chmod(blocked, 0);
  const path = join(root, 'active.excalidraw');
  await writeFile(path, drawing('#ffffff'));
  const service = await startService({ port: 0, stateDirectory: join(root, 'state') });
  const get = (route: string) => fetch(`http://127.0.0.1:${service.server.port}${route}`, { headers: { authorization: `Bearer ${service.token}` } }).then(r => r.json());
  try {
    await service.open(path); await service.open(root);
    let workspace = await get('/api/workspace');
    const deadline = Date.now() + 3000;
    while (workspace.scanning && Date.now() < deadline) { await Bun.sleep(10); workspace = await get('/api/workspace'); }
    expect(workspace.error).toContain('Could not read');
    expect((await get('/api/document')).error).toBe('');
  } finally { service.stop(); await chmod(blocked, 0o700); await rm(root, { recursive: true, force: true }); }
});

test('a delayed refresh cannot republish its old snapshot after a successful save', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'draw-sync-race-')));
  const path = join(root, 'active.excalidraw');
  await writeFile(path, drawing('#ffffff'));
  const service = await startService({ port: 0, stateDirectory: join(root, 'state') });
  const call = (route: string, body?: unknown) => fetch(`http://127.0.0.1:${service.server.port}${route}`, { headers: { authorization: `Bearer ${service.token}`, 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) }).then(r => r.json());
  const originalRead = Documents.prototype.read;
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const readStarted = new Promise<void>(resolve => { started = resolve; });
  let holdNext = true;
  let spy: ReturnType<typeof spyOn> | undefined;
  try {
    await service.open(path);
    const before = (await call('/api/document')).snapshot;
    spy = spyOn(Documents.prototype, 'read').mockImplementation(async function(this: Documents, candidate: string) {
      const result = await originalRead.call(this, candidate);
      if (candidate === path && holdNext) { holdNext = false; started(); await held; }
      return result;
    });
    const refreshing = service.sync(); await readStarted;
    const saved = await call('/api/save', { path, version: before.version, document: JSON.parse(drawing('#abcdef')) });
    release(); await refreshing;
    const after = (await call('/api/document')).snapshot;
    expect(after.version).toBe(saved.version);
    expect(after.document.appState.viewBackgroundColor).toBe('#abcdef');
  } finally { release(); spy?.mockRestore(); service.stop(); await rm(root, { recursive: true, force: true }); }
});
