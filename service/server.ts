import { watch, type FSWatcher } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { Documents, FileError, type Snapshot } from './files';

export async function startService(options: { port?: number; stateDirectory?: string; allowedOrigins?: string[]; testLoopbackOrigins?: boolean; workerPath?: string; editorDirectory?: string } = {}) {
  const editorDirectory = options.editorDirectory ?? resolve(import.meta.dir, '../dist/editor');
  const stateDirectory = options.stateDirectory ?? join(homedir(), 'Library/Application Support/Exact Draw');
  await mkdir(stateDirectory, { recursive: true });
  const documents = new Documents(join(stateDirectory, 'recovery'));
  const historyPath = join(stateDirectory, 'recent.json');
  const workspacePath = join(stateDirectory, 'workspace.json');
  const sessionPath = join(stateDirectory, 'document-session.json');
  let lastClosedPath = '';
  let savedActivePath = '';
  try {
    const saved = JSON.parse(await readFile(sessionPath, 'utf8'));
    savedActivePath = typeof saved.activePath === 'string' ? saved.activePath : '';
    lastClosedPath = typeof saved.lastClosedPath === 'string' ? saved.lastClosedPath : '';
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Could not restore document session:', error); }
  let recent: { path: string; name: string; kind: string }[] = [];
  try { recent = JSON.parse(await readFile(historyPath, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Could not restore recent locations:', error); }
  const token = crypto.randomUUID();
  let revision = 1, scanning = false, scanError = '', documentError = '', sessionError = '', active: Snapshot | null = null;
  let folders: string[] = [];
  let migrateWorkspace = false;
  const files = new Map<string, string[]>();
  let worker: Worker | undefined, fileWatcher: FSWatcher | undefined;
  let scanGeneration = 0;
  const expanded = new Set<string>(), opened = new Set<string>();
  let command: { action: string; destination?: string } | null = null;
  let operationQueue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>) => {
    const result = operationQueue.then(operation);
    operationQueue = result.catch(() => {});
    return result;
  };
  try {
    const saved = JSON.parse(await readFile(workspacePath, 'utf8'));
    if (!Array.isArray(saved.folders) || !saved.folders.every((path: unknown) => typeof path === 'string' && path.startsWith('/'))) throw new Error('Invalid saved folders.');
    folders = [...new Set<string>(saved.folders)];
    for (const path of Array.isArray(saved.expanded) ? saved.expanded : []) if (typeof path === 'string') expanded.add(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      migrateWorkspace = true;
      folders = [...new Set(recent.filter(item => item.kind === 'folder').map(item => item.path))];
      for (const path of folders) expanded.add(path);
    } else scanError = `Could not restore the workspace: ${(error as Error).message}`;
  }
  const subscribers = new Set<ReadableStreamDefaultController>();
  const encoder = new TextEncoder();
  const notify = (documentChanged = false) => { revision++; for (const client of subscribers) { try { client.enqueue(encoder.encode(`${documentChanged ? "" : "event: workspace\n"}data: ${revision}\n\n`)); } catch { subscribers.delete(client); } } };
  const notifyCommand = () => { for (const client of subscribers) { try { client.enqueue(encoder.encode('event: command\ndata: ready\n\n')); } catch { subscribers.delete(client); } } };
  let historyQueue = Promise.resolve();
  let workspaceQueue = Promise.resolve();
  async function persistWorkspace() {
    const bytes = JSON.stringify({ folders, expanded: [...expanded] }, null, 2);
    workspaceQueue = workspaceQueue.catch(() => {}).then(async () => {
      const temp = `${workspacePath}.tmp`;
      await writeFile(temp, bytes); await rename(temp, workspacePath);
    });
    await workspaceQueue;
  }
  if (migrateWorkspace) await persistWorkspace();
  async function remember(path: string, kind: string) {
    recent = [{ path, name: basename(path), kind }, ...recent.filter(item => item.path !== path)].slice(0, 24);
    await persistRecent();
  }
  async function persistRecent() {
    const bytes = JSON.stringify(recent, null, 2);
    historyQueue = historyQueue.catch(() => {}).then(async () => {
      const temp = `${historyPath}.tmp`;
      await writeFile(temp, bytes); await rename(temp, historyPath);
    });
    await historyQueue;
  }
  function discover() {
    worker?.terminate();
    const generation = ++scanGeneration;
    files.clear(); scanning = folders.length > 0; scanError = ''; notify();
    if (!scanning) { worker = undefined; return; }
    worker = new Worker(options.workerPath ?? new URL('./scan-worker.ts', import.meta.url).href);
    worker.onmessage = event => {
      if (generation !== scanGeneration) return;
      if (event.data.paths) {
        const found = files.get(event.data.root) ?? [];
        found.push(...event.data.paths); files.set(event.data.root, found);
      }
      if (event.data.error) scanError = event.data.error;
      if (event.data.done) { scanning = false; worker?.terminate(); worker = undefined; }
      notify();
    };
    worker.onerror = event => { if (generation !== scanGeneration) return; scanError = event.message; scanning = false; notify(); };
    worker.postMessage({ roots: folders });
  }
  let checking = false, lastStamp = "";
  async function sync(force = true) {
    if (checking || !active) return;
    checking = true;
    const reading = active, path = reading.path;
    try {
      const info = await stat(path);
      const stamp = `${path}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      if (!force && stamp === lastStamp && !documentError) return;
      const next = await documents.read(path);
      if (active !== reading) return;
      lastStamp = stamp;
      if (next.version !== active.version || documentError) { active = next; documentError = ''; notify(true); }
    } catch (reason) {
      if (active === reading) { const message = `Cannot refresh drawing: ${(reason as Error).message}`; if (documentError !== message) { documentError = message; notify(true); } }
    } finally { checking = false; }
  }
  const poll = setInterval(() => { void sync(false); }, 1500);
  async function activate(next: Snapshot | null, rememberFile = true) {
    fileWatcher?.close(); fileWatcher = undefined;
    active = next; documentError = ''; lastStamp = '';
    if (next) {
      opened.add(next.path);
      try { fileWatcher = watch(dirname(next.path), (_event, name) => { if (!name || String(name) === basename(next.path)) void sync(); }); }
      catch { /* periodic refresh still detects replacements when a watcher is unavailable */ }
      if (rememberFile) recent = [{ path: next.path, name: basename(next.path), kind: 'file' }, ...recent.filter(item => item.path !== next.path)].slice(0, 24);
    }
    notify(true);
    const failures: string[] = [];
    try { await persistRecent(); }
    catch (error) { failures.push(`recent locations: ${(error as Error).message}`); }
    try {
      const temp = `${sessionPath}.tmp`;
      await writeFile(temp, JSON.stringify({ activePath: next?.path ?? '', lastClosedPath }));
      await rename(temp, sessionPath);
    } catch (error) { failures.push(`reopen state: ${(error as Error).message}`); }
    sessionError = failures.length ? `The drawing action completed, but could not save ${failures.join('; ')}. This session is current; reopening the app may show older locations.` : '';
    notify(true);
  }
  async function open(path: string) {
    path = path.startsWith('~/') ? join(homedir(), path.slice(2)) : resolve(path);
    const canonical = await realpath(path);
    const info = await stat(canonical);
    if (info.isDirectory()) {
      if (!folders.includes(canonical)) folders.push(canonical);
      expanded.add(canonical);
      await persistWorkspace(); await remember(canonical, 'folder'); discover(); return;
    }
    const next = await documents.read(canonical);
    await activate(next);
  }
  async function lifecycle(body: { action: string; path?: string; version?: string; destination?: string; name?: string; id?: string; checkpointId?: string }) {
    const before = active;
    if (before && (body.path !== before.path || body.version !== before.version)) throw new FileError('The active drawing changed. Retry the action from its current canvas.', 409);
    if (!before && body.path) throw new FileError('That drawing is no longer open.', 409);
    let next: Snapshot | null = before;
    switch (body.action) {
      case 'new': next = await documents.create(required(body.destination, 'Choose a destination.')); break;
      case 'open': await open(required(body.destination, 'Choose a drawing.')); return { snapshot: active };
      case 'reopen':
        if (!lastClosedPath) throw new FileError('There is no recently closed drawing.');
        next = await documents.read(lastClosedPath); break;
      case 'restore-trash': next = await documents.restoreTrash(required(body.id, 'Choose a drawing in Trash.'), body.destination); break;
      default: {
        if (!before) throw new FileError('Open a drawing first.');
        switch (body.action) {
          case 'close': lastClosedPath = before.path; next = null; break;
          case 'save-as': next = await documents.duplicate(before.path, before.version, required(body.destination, 'Choose a destination.')); break;
          case 'duplicate': {
            const stem = before.path.slice(0, -'.excalidraw'.length);
            for (let index = 1; ; index++) {
              const destination = `${stem} copy${index === 1 ? '' : ` ${index}`}.excalidraw`;
              try { await lstat(destination); continue; }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
              try { next = await documents.duplicate(before.path, before.version, destination); break; }
              catch (error) { if (!(error instanceof FileError) || error.status !== 409 || !error.message.includes('already exists')) throw error; }
            }
            break;
          }
          case 'rename': {
            const name = required(body.name, 'Enter a drawing name.').trim().replace(/\.excalidraw$/, '');
            if (!name || name === '.' || name === '..' || /[\/\\\0]/.test(name)) throw new FileError('Use a filename without slashes.');
            next = await documents.move(before.path, before.version, join(dirname(before.path), `${name}.excalidraw`)); break;
          }
          case 'move': next = await documents.move(before.path, before.version, required(body.destination, 'Choose a destination.')); break;
          case 'trash': await documents.trash(before.path, before.version); next = null; break;
          case 'checkpoint': next = await documents.checkpoint(before.path, before.version); break;
          case 'restore-history': next = await documents.restore(before.path, before.version, required(body.checkpointId, 'Choose a version.')); break;
          default: throw new FileError('Unknown document action.');
        }
      }
    }
    if (before && ['rename', 'move', 'trash'].includes(body.action)) {
      opened.delete(before.path);
      recent = recent.filter(item => item.path !== before.path);
      if (lastClosedPath === before.path) lastClosedPath = next?.path ?? '';
    }
    await activate(next);
    if (!['close', 'checkpoint', 'restore-history'].includes(body.action)) discover();
    return { snapshot: next };
  }
  function required(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new FileError(message);
    return value;
  }
  function folderEntries(root: string, query: string) {
    const normalizedQuery = query.toLowerCase();
    const visible = new Map<string, { path: string; name: string; depth: number; directory: boolean; expanded: boolean }>();
    for (const path of files.get(root) ?? []) {
      const rel = relative(root, path), parts = rel.split(sep);
      if (query && !rel.toLowerCase().includes(normalizedQuery)) continue;
      let parent = root;
      for (let i = 0; i < parts.length; i++) {
        parent = join(parent, parts[i]);
        const directory = i < parts.length - 1;
        visible.set(parent, { path: parent, name: parts[i], depth: i, directory, expanded: query !== '' || expanded.has(parent) });
        if (directory && !query && !expanded.has(parent)) break;
      }
    }
    return [...visible.values()].sort((a, b) => {
      const aa = relative(root, a.path).split(sep), bb = relative(root, b.path).split(sep);
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        if (aa[i] === bb[i]) continue;
        const ad = i < aa.length - 1 || a.directory, bd = i < bb.length - 1 || b.directory;
        if (ad !== bd) return ad ? -1 : 1;
        return aa[i].localeCompare(bb[i]);
      }
      return aa.length - bb.length;
    });
  }
  function entries(query: string) {
    return folders.flatMap(folder => {
      const isExpanded = query !== '' || expanded.has(folder);
      return [
        { id: encodeURIComponent(folder), path: folder, name: basename(folder), depth: 0, directory: true, expanded: isExpanded, workspaceFolder: true },
        ...(isExpanded ? folderEntries(folder, query).map(entry => ({ ...entry, id: `${encodeURIComponent(folder)}--${encodeURIComponent(entry.path)}`, depth: entry.depth + 1, workspaceFolder: false })) : []),
      ];
    });
  }
  const port = options.port ?? 47931;
  const server: Bun.Server<undefined> = Bun.serve({
    hostname: '127.0.0.1', port, idleTimeout: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url);
      const origin = request.headers.get('origin');
      const localOrigin = `http://127.0.0.1:${server.port}`;
      const allowedOrigin = origin !== null && (origin === localOrigin || options.allowedOrigins?.includes(origin) === true || (options.testLoopbackOrigins === true && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)));
      const headers: Record<string, string> = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      if (allowedOrigin) Object.assign(headers, { 'access-control-allow-origin': origin!, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'Origin' });
      const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
      const embeddedNavigation = url.pathname === '/editor' && url.searchParams.get('token') === token;
      if (request.headers.get('host') !== `127.0.0.1:${server.port}` || (!embeddedNavigation && ((origin && !allowedOrigin) || request.headers.get('sec-fetch-site') === 'cross-site'))) return json({ error: 'Local access only.' }, 403);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      const authenticated = request.headers.get('authorization') === `Bearer ${token}` || url.searchParams.get('token') === token;
      if (url.pathname === '/session') return json({ token, editorUrl: `${localOrigin}/editor?token=${token}` });
      if (url.pathname.startsWith('/api/') || url.pathname === '/events' || url.pathname === '/editor') {
        if (!authenticated) return json({ error: 'Restart the app to reconnect to its local file service.' }, 401);
      }
      try {
        if (url.pathname === '/api/workspace') {
          if (url.searchParams.get('since') === String(revision)) return json({ unchanged: true });
          return json({ revision, root: folders[0] ?? '', folders, activePath: active?.path ?? '', activeName: active ? basename(active.path) : 'No drawing open', scanning, scanCount: new Set([...files.values()].flat()).size, error: scanError || documentError || sessionError, entries: entries(url.searchParams.get('query') ?? ''), recent: recent.map(item => ({ ...item, id: encodeURIComponent(item.path) })) });
        }
        if (url.pathname === '/api/document') return json({ snapshot: active, error: documentError });
        if (url.pathname === '/api/command' && request.method === 'POST') {
          const body = await request.json();
          if (!['new', 'open', 'save-as', 'move', 'rename', 'duplicate', 'close', 'reopen', 'history', 'trash', 'show-trash'].includes(body.action)) throw new FileError('Unknown document command.');
          if (command) throw new FileError('The editor is still handling a file action. Try again shortly.', 409);
          command = { action: body.action, destination: body.destination };
          notifyCommand(); return json({ ok: true });
        }
        if (url.pathname === '/api/command/take' && request.method === 'POST') {
          const taken = command; command = null; return json({ command: taken });
        }
        if (url.pathname === '/api/lifecycle' && request.method === 'POST') {
          const body = await request.json();
          return json(await serialize(() => lifecycle(body)));
        }
        if (url.pathname === '/api/trash') return json({ entries: await documents.listTrash() });
        if (url.pathname === '/api/history' || url.pathname === '/api/history/preview') {
          const path = required(url.searchParams.get('path'), 'Open a drawing first.');
          if (!opened.has(path)) throw new FileError('Open the drawing before reading its history.', 403);
          return json(url.pathname.endsWith('/preview')
            ? await documents.preview(path, required(url.searchParams.get('id'), 'Choose a version.'))
            : { entries: await documents.history(path) });
        }
        if (url.pathname === '/api/sync' && request.method === 'POST') { await sync(); return json({ ok: true }); }
        if (url.pathname === '/api/open' && request.method === 'POST') { const body = await request.json(); await serialize(() => open(body.path)); return json({ ok: true }); }
        if (url.pathname === '/api/toggle' && request.method === 'POST') { const { path } = await request.json(); if (expanded.has(path)) expanded.delete(path); else expanded.add(path); await persistWorkspace(); notify(); return json({ ok: true }); }
        if (url.pathname === '/api/remove-folder' && request.method === 'POST') {
          const { path } = await request.json();
          folders = folders.filter(folder => folder !== path); expanded.delete(path);
          await persistWorkspace(); discover(); return json({ ok: true });
        }
        if (url.pathname === '/api/rescan' && request.method === 'POST') { discover(); return json({ ok: true }); }
        if (url.pathname === '/api/save' && request.method === 'POST') {
          const body = await request.json();
          if (!opened.has(body.path)) throw new FileError('Open the drawing before saving it.', 403);
          return json(await serialize(async () => {
            if (!opened.has(body.path)) throw new FileError('That drawing has moved or closed. Reopen it before saving.', 409);
            const saved = await documents.save(body.path, body.version, body.document);
            if (active?.path === saved.path) { active = saved; documentError = ''; lastStamp = ''; }
            notify(true); return saved;
          }));
        }
        if (url.pathname === '/api/recover' && request.method === 'POST') {
          const body = await request.json();
          if (!opened.has(body.path)) throw new FileError('Open the drawing before recovering it.', 403);
          return json({ path: await documents.recover(body.path, body.document) });
        }
        if (url.pathname === '/events') {
          let client: ReadableStreamDefaultController;
          return new Response(new ReadableStream({ start(controller) { client = controller; subscribers.add(controller); controller.enqueue(encoder.encode(`data: ${revision}\n\n`)); }, cancel() { subscribers.delete(client); } }), { headers: { ...headers, 'content-type': 'text/event-stream' } });
        }
        if (url.pathname === '/editor') {
          const html = await Bun.file(join(editorDirectory, 'index.html')).text();
          return new Response(html, { headers: { ...headers, 'content-type': 'text/html', 'referrer-policy': 'no-referrer' } });
        }
        if (url.pathname.startsWith('/assets/')) {
          const base = editorDirectory;
          const path = resolve(base, decodeURIComponent(url.pathname.slice('/assets/'.length)));
          if (!path.startsWith(base + sep)) return json({ error: 'Invalid asset path.' }, 403);
          const file = Bun.file(path);
          if (await file.exists()) return new Response(file, { headers: { 'x-content-type-options': 'nosniff' } });
        }
        return json({ error: 'Not found.' }, 404);
      } catch (reason) { return json({ error: (reason as Error).message }, reason instanceof FileError ? reason.status : 400); }
    },
  });
  if (savedActivePath) {
    try { await activate(await documents.read(savedActivePath), false); }
    catch (error) { documentError = `Could not reopen drawing: ${(error as Error).message}`; }
  }
  if (folders.length) discover();
  return { server, token, open, sync, stop() {
    clearInterval(poll); worker?.terminate(); fileWatcher?.close();
    for (const client of subscribers) { try { client.close(); } catch {} }
    server.stop(true);
    return operationQueue.then(() => documents.closeWhenIdle());
  } };
}

if (import.meta.main) {
  const service = await startService();
  console.log(`Exact Draw file service: http://127.0.0.1:${service.server.port}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { service.stop(); process.exit(); });
}
