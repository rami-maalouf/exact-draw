import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, rm, link, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { History, type Transfer } from './history';

export type Drawing = { type: 'excalidraw'; version: number; elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown>; [key: string]: unknown };
export type Snapshot = { id: string; path: string; version: string; document: Drawing };
export class FileError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const digest = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
export function validateDrawing(value: unknown): Drawing {
  const doc = value as Drawing;
  if (!doc || doc.type !== 'excalidraw' || !Array.isArray(doc.elements) || typeof doc.appState !== 'object' || !doc.appState) {
    throw new FileError('This is not a complete Excalidraw drawing. Waiting for a valid file.');
  }
  return { ...doc, files: doc.files ?? {} };
}
const encode = (document: Drawing) => JSON.stringify(document, null, 2) + '\n';
async function durableWrite(path: string, bytes: string, mode?: number) {
  const file = await open(path, 'wx', mode);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function exists(path: string) {
  try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export class Documents {
  private queue: Promise<unknown> = Promise.resolve();
  private store?: History;
  constructor(private recoveryDirectory: string) {}
  private async initialize() {
    if (this.store) return;
    this.store = new History(this.recoveryDirectory);
    try {
      for (const transfer of this.store.pending()) await this.reconcile(transfer);
    } catch (error) {
      this.store.close();
      this.store = undefined;
      throw error;
    }
  }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => { await this.initialize(); return operation(); });
    this.queue = result.catch(() => {});
    return result;
  }
  close() { this.store?.close(); this.store = undefined; }
  private async readCurrent(path: string, source = 'external'): Promise<Snapshot> {
    if (!path.endsWith('.excalidraw')) throw new FileError('Only .excalidraw files are supported.');
    const canonical = await realpath(path);
    if (!canonical.endsWith('.excalidraw') || !(await lstat(canonical)).isFile()) throw new FileError('Choose a regular .excalidraw file.');
    const bytes = await readFile(canonical, 'utf8');
    const document = validateDrawing(JSON.parse(bytes));
    const existing = this.store!.find(canonical);
    const record = existing ?? this.store!.register(canonical);
    const version = digest(bytes);
    this.store!.record(record.id, bytes, version, existing ? source : 'open');
    return { id: record.id, path: canonical, version, document };
  }
  read(path: string): Promise<Snapshot> { return this.run(() => this.readCurrent(path)); }
  private async checked(path: string, version: string) {
    const current = await this.readCurrent(path);
    if (current.version !== version) throw new FileError('The file changed on disk. Your edits were not written over it.', 409);
    return current;
  }
  save(path: string, version: string, document: Drawing, source = 'save'): Promise<Snapshot> {
    return this.run(() => this.writeCurrent(path, version, document, source));
  }
  private async writeCurrent(path: string, version: string, document: Drawing, source: string): Promise<Snapshot> {
    validateDrawing(document);
    const current = await this.checked(path, version);
    const merged = source === 'restore' ? document : { ...current.document, ...Object.fromEntries(Object.entries(document).filter(([, value]) => value !== undefined)) };
    const bytes = encode(merged);
    const nextVersion = digest(bytes);
    if (nextVersion === version) {
      if (source === 'restore') this.store!.record(current.id, bytes, version, source, true);
      return current;
    }
    const temp = `${current.path}.${randomUUID()}.tmp`;
    try {
      await durableWrite(temp, bytes, (await lstat(current.path)).mode);
      const backup = join(this.recoveryDirectory, `${digest(current.path)}.previous.excalidraw`);
      const backupTemp = `${backup}.${randomUUID()}.tmp`;
      try { await durableWrite(backupTemp, encode(current.document)); await rename(backupTemp, backup); }
      finally { await rm(backupTemp, { force: true }); }
      await this.checked(current.path, version);
      await rename(temp, current.path);
      this.store!.record(current.id, bytes, nextVersion, source, source === 'restore');
      return { id: current.id, path: current.path, version: nextVersion, document: merged };
    } finally { await rm(temp, { force: true }); }
  }
  private async destination(path: string) {
    if (!path.endsWith('.excalidraw')) throw new FileError('Only .excalidraw files are supported.');
    return join(await realpath(dirname(resolve(path))), basename(path));
  }
  private async createCurrent(path: string, document: Drawing, source: string): Promise<Snapshot> {
    const destination = await this.destination(path);
    const validated = validateDrawing(document);
    const bytes = encode(validated);
    // publish a fully written file exclusively, so an interrupted create never exposes partial json.
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await durableWrite(temporary, bytes);
      try { await link(temporary, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FileError('A file already exists at that destination.', 409); throw error; }
      const record = this.store!.fresh(destination);
      const version = digest(bytes);
      this.store!.record(record.id, bytes, version, source);
      return { id: record.id, path: destination, version, document: validated };
    } finally { await rm(temporary, { force: true }); }
  }
  create(path: string, document: Drawing = { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }) {
    return this.run(() => this.createCurrent(path, document, 'create'));
  }
  duplicate(path: string, version: string, destination: string) {
    return this.run(async () => this.createCurrent(destination, (await this.checked(path, version)).document, 'duplicate'));
  }
  private async transfer(current: Snapshot, destination: string, kind: Transfer['kind']): Promise<Snapshot> {
    const target = await this.destination(destination);
    if (target === current.path) return current;
    const transfer: Transfer = { id: current.id, source: current.path, destination: target, temporary: `${target}.${randomUUID()}.tmp`, version: current.version, kind, deletedAt: kind === 'trash' ? new Date().toISOString() : null };
    const bytes = await readFile(current.path, 'utf8');
    if (digest(bytes) !== current.version) throw new FileError('The file changed on disk. Please reload it.', 409);
    this.store!.begin(transfer);
    try {
      await durableWrite(transfer.temporary, bytes, (await lstat(current.path)).mode);
      try { await link(transfer.temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FileError('A file already exists at that destination.', 409); throw error; }
      await this.checked(current.path, current.version);
      await unlink(current.path);
      this.store!.finish(transfer);
      await rm(transfer.temporary, { force: true });
      return { ...current, path: target };
    } catch (error) {
      await this.reconcile(transfer);
      throw error;
    }
  }
  private async reconcile(transfer: Transfer) {
    const staged = await exists(transfer.temporary);
    const target = await exists(transfer.destination);
    const source = await exists(transfer.source);
    const ownsTarget = staged && target && staged.ino === target.ino && staged.dev === target.dev;
    const sourceUnchanged = source?.isFile() && digest(await readFile(transfer.source, 'utf8')) === transfer.version;
    if (ownsTarget && !sourceUnchanged) this.store!.finish(transfer);
    else if (ownsTarget) {
      // before source removal, rollback only our own unchanged destination; keep external edits.
      if (digest(await readFile(transfer.destination, 'utf8')) === transfer.version) await unlink(transfer.destination);
      this.store!.cancel(transfer.id);
    } else if (staged && !sourceUnchanged) {
      // an external replacement may leave the staging file as the only intact original.
      const bytes = await readFile(transfer.temporary, 'utf8');
      if (digest(bytes) !== transfer.version) throw new FileError('An interrupted move needs recovery. Its staging file has been preserved.', 409);
      const recoveryPath = join(await realpath(this.recoveryDirectory), `interrupted-move-${randomUUID()}.excalidraw`);
      await durableWrite(recoveryPath, bytes);
      this.store!.finish({ ...transfer, destination: recoveryPath });
    } else this.store!.cancel(transfer.id);
    await rm(transfer.temporary, { force: true });
  }
  move(path: string, version: string, destination: string) {
    return this.run(async () => this.transfer(await this.checked(path, version), destination, 'move'));
  }
  trash(path: string, version: string) {
    return this.run(async () => {
      const current = await this.checked(path, version);
      const trashDirectory = join(this.recoveryDirectory, 'trash');
      await mkdir(trashDirectory, { recursive: true });
      await this.transfer(current, join(trashDirectory, `${current.id}.excalidraw`), 'trash');
      return { id: current.id, path: current.path };
    });
  }
  listTrash() {
    return this.run(async () => this.store!.trash().map(record => ({ id: record.id, path: record.originalPath!, name: basename(record.originalPath!), deletedAt: record.deletedAt! })));
  }
  restoreTrash(id: string, destination?: string) {
    return this.run(async () => {
      const record = this.store!.get(id);
      if (!record?.deletedAt || !record.originalPath) throw new FileError('That drawing is not in the trash.', 404);
      return this.transfer(await this.readCurrent(record.path), destination ?? record.originalPath, 'restore');
    });
  }
  history(path: string) { return this.run(async () => this.store!.list((await this.readCurrent(path)).id)); }
  checkpoint(path: string, version: string) {
    return this.run(async () => {
      const current = await this.checked(path, version);
      const bytes = await readFile(current.path, 'utf8');
      if (digest(bytes) !== version) throw new FileError('The file changed on disk. Please reload it.', 409);
      this.store!.record(current.id, bytes, version, 'checkpoint', true);
      return current;
    });
  }
  preview(path: string, checkpointId: string) {
    return this.run(async () => {
      const current = await this.readCurrent(path);
      const revision = this.store!.revision(current.id, checkpointId);
      if (!revision) throw new FileError('This history revision is no longer available.', 404);
      return { id: current.id, path: current.path, version: revision.version, document: validateDrawing(JSON.parse(revision.bytes)) };
    });
  }
  restore(path: string, version: string, checkpointId: string) {
    return this.run(async () => {
      const current = await this.checked(path, version);
      const revision = this.store!.revision(current.id, checkpointId);
      if (!revision) throw new FileError('This history revision is no longer available.', 404);
      return this.writeCurrent(current.path, version, validateDrawing(JSON.parse(revision.bytes)), 'restore');
    });
  }
  async recover(path: string, document: Drawing) {
    validateDrawing(document);
    await mkdir(this.recoveryDirectory, { recursive: true });
    const destination = join(this.recoveryDirectory, `${basename(path, '.excalidraw')}-${randomUUID()}.excalidraw`);
    await durableWrite(destination, encode(document));
    return destination;
  }
}
