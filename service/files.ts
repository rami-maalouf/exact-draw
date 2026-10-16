import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export type Drawing = { type: 'excalidraw'; version: number; elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown>; [key: string]: unknown };
export type Snapshot = { path: string; version: string; document: Drawing };
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
export class Documents {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private recoveryDirectory: string) {}
  async read(path: string): Promise<Snapshot> {
    if (!path.endsWith('.excalidraw')) throw new FileError('Only .excalidraw files are supported.');
    const canonical = await realpath(path);
    if (!canonical.endsWith('.excalidraw') || !(await lstat(canonical)).isFile()) throw new FileError('Choose a regular .excalidraw file.');
    const bytes = await readFile(canonical, 'utf8');
    return { path: canonical, version: digest(bytes), document: validateDrawing(JSON.parse(bytes)) };
  }
  save(path: string, version: string, document: Drawing): Promise<Snapshot> {
    const operation = this.queue.then(async () => {
      validateDrawing(document);
      const current = await this.read(path);
      if (current.version !== version) throw new FileError('The file changed on disk. Your edits were not written over it.', 409);
      const merged = { ...current.document, ...Object.fromEntries(Object.entries(document).filter(([, value]) => value !== undefined)) };
      const bytes = JSON.stringify(merged, null, 2) + '\n';
      const nextVersion = digest(bytes);
      if (nextVersion === version) return current;
      const temp = `${current.path}.${randomUUID()}.tmp`;
      try {
        const info = await lstat(current.path);
        await writeFile(temp, bytes, { flag: 'wx', mode: info.mode });
        await mkdir(this.recoveryDirectory, { recursive: true });
        await writeFile(join(this.recoveryDirectory, `${digest(current.path)}.previous.excalidraw`), JSON.stringify(current.document));
        if ((await this.read(current.path)).version !== version) throw new FileError('The file changed while saving. Your edits were not written over it.', 409);
        await rename(temp, current.path);
        return { path: current.path, version: nextVersion, document: merged };
      } finally { await rm(temp, { force: true }); }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async recover(path: string, document: Drawing) {
    validateDrawing(document);
    await mkdir(this.recoveryDirectory, { recursive: true });
    const destination = join(this.recoveryDirectory, `${basename(path, '.excalidraw')}-${randomUUID()}.excalidraw`);
    await writeFile(destination, JSON.stringify(document, null, 2), { flag: 'wx' });
    return destination;
  }
}
