import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from './server';
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
    service.stop();
    service = await startService({ port: 0, stateDirectory });
    const restored = await call('/api/workspace');
    expect(restored.recent.map((entry: { path: string }) => entry.path)).toEqual([root, path]);
  } finally { service.stop(); await rm(root, { recursive: true, force: true }); }
});
