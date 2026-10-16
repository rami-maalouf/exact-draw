import type { Answer, Result, Sources } from './app.contract.d.ts';
export const appId = 'com.example.exact-draw-ba51d7';
const API = 'http://127.0.0.1:47931';
export const grants = `net.fetch ${API}`;
let session: { token: string; editorUrl: string } | undefined;
let revision = -1, lastQuery = '';
let last: Result<'loadWorkspace'> = { root: '', activePath: '', activeName: 'No drawing open', scanning: false, scanCount: 0, error: '', entries: [], recent: [], editorUrl: '' };
async function call(route: string, body?: unknown): Promise<any> {
  if (!session) {
    const response = await fetch(`${API}/session`);
    if (!response.ok) throw new Error('The local file service could not be reached.');
    session = await response.json();
    revision = -1;
  }
  const response = await fetch(`${API}${route}`, {
    headers: { authorization: `Bearer ${session!.token}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401) { session = undefined; throw new Error('Reconnecting to the local file service…'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'The file operation failed.');
  return result;
}
async function action(route: string, body: unknown) {
  try { await call(route, body); revision = -1; return { ok: true, error: '' }; }
  catch (error) { if ((error as { code?: string }).code === 'bake') throw error; return { ok: false, error: (error as Error).message }; }
}
const sources: Sources = {
  loadWorkspace: async ([query]) => {
    try {
      const result = await call(`/api/workspace?since=${query === lastQuery ? revision : -1}&query=${encodeURIComponent(query)}`);
      if (!result.unchanged) {
        revision = result.revision; lastQuery = query;
        last = { root: result.root, activePath: result.activePath, activeName: result.activeName, scanning: result.scanning, scanCount: result.scanCount, error: result.error, entries: result.entries, recent: result.recent, editorUrl: session!.editorUrl };
      }
      return last;
    } catch (error) {
      if ((error as { code?: string }).code === 'bake') throw error;
      session = undefined;
      return { ...last, error: 'Start the local file service with bun run start, then try again.' };
    }
  },
  openLocation: ([path]) => action('/api/open', { path }),
  toggleFolder: ([path]) => action('/api/toggle', { path }),
  rescanFolder: () => action('/api/rescan', {}),
};
export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);
