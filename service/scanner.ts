import { opendir } from 'node:fs/promises';
import { join } from 'node:path';

export const ignoredDirectories = new Set(['node_modules', '.git', '.svn', '.hg', '.next', '.nuxt', '.cache', '.turbo', '.venv', 'venv', '__pycache__', 'target', 'dist', 'build']);
export async function scan(root: string, batch: (paths: string[]) => void, warning: (message: string) => void = () => {}) {
  const pending = [root];
  let paths: string[] = [];
  let last = performance.now();
  while (pending.length) {
    const directory = pending.pop()!;
    try {
      for await (const entry of await opendir(directory)) {
        if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) pending.push(join(directory, entry.name));
        else if (entry.isFile() && entry.name.endsWith('.excalidraw')) paths.push(join(directory, entry.name));
        if (paths.length >= 250 || performance.now() - last > 50) {
          if (paths.length) batch(paths);
          paths = []; last = performance.now();
        }
      }
    } catch (error) { warning(`Could not read ${directory}: ${(error as Error).message}`); }
  }
  if (paths.length) batch(paths);
}
