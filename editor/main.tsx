import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureUpdateAction, Excalidraw, MainMenu, restore, serializeAsJSON } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, LibraryItems } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import './style.css';

type Drawing = { type: 'excalidraw'; version: number; elements: ExcalidrawElement[]; appState: Partial<AppState>; files: BinaryFiles };
type Snapshot = { path: string; version: string; document: Drawing };
type Status = 'Opening' | 'Saved' | 'Unsaved' | 'Saving' | 'Offline' | 'Conflict';
const parameters = new URLSearchParams(location.search);
const token = parameters.get('token') ?? '';
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const contentKey = (document: Drawing) => stable({ elements: document.elements, appState: document.appState, files: document.files });
class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.error ?? 'The file service could not complete this request.', response.status);
  return data;
}
function readLibrary(): LibraryItems { try { return JSON.parse(localStorage.getItem('exact-draw-library') ?? '[]'); } catch { return []; } }

function Editor() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [path, setPath] = useState('');
  const [status, setStatus] = useState<Status>('Opening');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(false);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const useDiskRef = useRef<() => Promise<void>>(async () => {});
  const changedRef = useRef<(elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) => void>(() => {});
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!api) return;
    const editor = api;
    let disposed = false, current: Snapshot | null = null, latest: Drawing | null = null, savedKey = '', latestKey = '', applying = false;
    let blocked = false, externalError = '', recovering = false;
    let uncertainSave: { path: string; key: string } | null = null;
    let saving: Promise<boolean> | null = null, refreshing: Promise<void> | null = null, refreshAgain = false;
    let timer: ReturnType<typeof setTimeout> | undefined, eventTimer: ReturnType<typeof setTimeout> | undefined;
    const capture = () => JSON.parse(serializeAsJSON(editor.getSceneElements(), editor.getAppState(), editor.getFiles(), 'local')) as Drawing;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { void save(); }, 400); };

    const draftKey = (path: string) => `exact-draw-draft:${path}`;
    function persistDraft() {
      if (!current || !latest) return;
      try { localStorage.setItem(draftKey(current.path), JSON.stringify({ version: current.version, document: latest })); }
      catch { setNotice('The local recovery draft could not be stored. Keep this window open until the drawing shows Saved.'); }
    }
    function clearDraft(path: string) { try { localStorage.removeItem(draftKey(path)); } catch {} }
    function readDraft(path: string): { version: string; document: Drawing } | null {
      try {
        const draft = JSON.parse(localStorage.getItem(draftKey(path)) ?? 'null');
        return draft && typeof draft.version === 'string' && draft.document?.type === 'excalidraw' && Array.isArray(draft.document.elements) ? draft : null;
      } catch { return null; }
    }
    async function preserve() {
      if (!current || !latest) return '';
      const result = await request<{ path: string }>('/api/recover', { path: current.path, document: latest });
      return result.path;
    }
    async function showConflict() {
      if (blocked) return;
      blocked = true; clearTimeout(timer); setConflict(true); setStatus('Conflict');
      setNotice('This drawing could not be safely saved. Your edits are held here while a recovery copy is saved.');
      try { const recovery = await preserve(); setNotice(`Your edits are safe in ${recovery}. Choose Use disk version to load the latest selected file.`); }
      catch { setNotice('This file changed on disk. Your edits are still held in this window. Recovery could not be saved; keep this window open and retry.'); }
    }
    async function save(): Promise<boolean> {
      if (saving) return saving;
      if (!dirtyRef.current) return true;
      if (!current || !latest || blocked || externalError || applying) return false;
      saving = (async () => {
        while (dirtyRef.current && current && latest && !blocked && !externalError) {
          const path: string = current.path;
          const document: Drawing = latest, key = contentKey(document);
          setStatus('Saving');
          try {
            const result: Snapshot = await request<Snapshot>('/api/save', { path, version: current.version, document });
            uncertainSave = null;
            current = result; savedKey = key;
            dirtyRef.current = contentKey(latest) !== savedKey;
            if (!dirtyRef.current) { clearDraft(path); setStatus('Saved'); setNotice(''); }
            else persistDraft();
          } catch (error) {
            if (error instanceof RequestError && error.status === 409) await showConflict();
            else { uncertainSave = { path, key }; setStatus('Offline'); setNotice(`Your edits are still in this window. ${(error as Error).message} Use Retry to save them.`); }
            return false;
          }
        }
        return !dirtyRef.current;
      })();
      try { return await saving; } finally { saving = null; }
    }
    async function apply(snapshot: Snapshot) {
      applying = true; setLoading(true); clearTimeout(timer);
      const sameFile = current?.path === snapshot.path;
      const view = editor.getAppState();
      const restored = restore(snapshot.document, null, null);
      const ids = new Set(restored.elements.filter(element => !element.isDeleted).map(element => element.id));
      const selectedElementIds = sameFile ? Object.fromEntries(Object.entries(view.selectedElementIds).filter(([id, selected]) => selected && ids.has(id))) : {};
      current = snapshot; setPath(snapshot.path);
      editor.resetScene();
      editor.addFiles(Object.values(restored.files));
      editor.updateScene({ elements: restored.elements, appState: { ...restored.appState, ...(sameFile ? { scrollX: view.scrollX, scrollY: view.scrollY, zoom: view.zoom } : {}), selectedElementIds }, captureUpdate: CaptureUpdateAction.NEVER });
      editor.history.clear();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (disposed) return;
      latest = capture(); savedKey = contentKey(latest); latestKey = savedKey; dirtyRef.current = false;
      applying = false; setLoading(false); setStatus('Saved');
    }
    async function refresh() {
      if (disposed) return;
      if (refreshing) { refreshAgain = true; return refreshing; }
      refreshing = (async () => {
        do {
          refreshAgain = false;
          try {
            if (saving) await saving;
            const requestedFrom = current;
            const response = await request<{ snapshot: Snapshot | null; error: string }>('/api/document');
            if (disposed) return;
            if (saving || current !== requestedFrom) { if (saving) await saving; refreshAgain = true; continue; }
            externalError = response.error;
            if (externalError) { clearTimeout(timer); setNotice(`${externalError} The current canvas is preserved; autosave is paused.`); if (!blocked) setStatus('Unsaved'); return; }
            if (blocked) return;
            const next = response.snapshot;
            if (!next) { if (!current) setStatus('Saved'); return; }
            if (current?.path !== next.path) {
              if (dirtyRef.current && !(await save())) { if (!blocked) await showConflict(); return; }
              const draft = readDraft(next.path);
              if (draft) {
                await apply({ ...next, version: draft.version, document: draft.document });
                savedKey = ''; dirtyRef.current = true;
                if (draft.version !== next.version) await showConflict();
                else { setStatus('Unsaved'); setNotice('Recovered your unsaved edits. Saving them to the drawing.'); schedule(); }
              } else { await apply(next); setNotice(''); }
            } else if (current.version !== next.version) {
              if (uncertainSave?.path === next.path && uncertainSave.key === contentKey(next.document)) {
                current = next; savedKey = uncertainSave.key; uncertainSave = null;
                dirtyRef.current = latestKey !== savedKey;
                if (dirtyRef.current) { persistDraft(); schedule(); }
                else { clearDraft(next.path); setStatus('Saved'); setNotice(''); }
              } else if (dirtyRef.current) await showConflict();
              else { await apply(next); setNotice(''); }
            } else {
              if (dirtyRef.current) schedule();
              else { setStatus('Saved'); setNotice(''); }
            }
          } catch (error) { if (!disposed) { setStatus('Offline'); setNotice(`Cannot reach the file service. ${(error as Error).message}`); } }
        } while (refreshAgain && !disposed);
      })();
      try { await refreshing; } finally { refreshing = null; }
    }
    changedRef.current = (elements, state, files) => {
      if (applying || !current || blocked) return;
      const document: Drawing = JSON.parse(serializeAsJSON(elements, state, files, 'local'));
      const key = contentKey(document);
      if (key === latestKey) return;
      latest = document; latestKey = key;
      dirtyRef.current = key !== savedKey;
      if (dirtyRef.current) { setStatus('Unsaved'); persistDraft(); if (!externalError) schedule(); }
      else { if (saving) persistDraft(); else clearDraft(current.path); setStatus('Saved'); }
    };
    saveRef.current = async () => { await request('/api/sync', {}); await refresh(); return save(); };
    useDiskRef.current = async () => {
      if (recovering) return;
      recovering = true;
      try {
        const previousPath = current?.path;
        const recovery = await preserve();
        await request('/api/sync', {});
        const response = await request<{ snapshot: Snapshot | null; error: string }>('/api/document');
        if (response.error || !response.snapshot) throw new Error(response.error || 'No valid drawing is available on disk.');
        await apply(response.snapshot); blocked = false; externalError = ''; setConflict(false);
        if (previousPath) clearDraft(previousPath);
        setNotice(`Loaded the disk version. Your previous edits were preserved in ${recovery}.`);
      } catch (error) { setNotice(`Your canvas has been kept. ${(error as Error).message}`); }
      finally { recovering = false; }
    };
    const events = new EventSource(`/events?token=${encodeURIComponent(token)}`);
    events.onmessage = () => { clearTimeout(eventTimer); eventTimer = setTimeout(() => { void refresh(); }, 80); };
    events.onopen = () => { void refresh(); };
    events.onerror = () => { if (!blocked) { setStatus('Offline'); setNotice('Connection interrupted. Your canvas is kept here while the file service reconnects.'); } };
    const wake = () => { if (document.visibilityState !== 'hidden') void request('/api/sync', {}).then(refresh).catch(() => { setStatus('Offline'); }); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake); window.addEventListener('beforeunload', beforeUnload);
    void refresh();
    return () => { disposed = true; clearTimeout(timer); clearTimeout(eventTimer); events.close(); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); window.removeEventListener('beforeunload', beforeUnload); };
  }, [api]);

  return <main className={`editor-shell${parameters.get('titlebar') === 'overlay' ? ' editor-shell-overlay' : ''}${notice ? ' editor-shell-notice' : ''}`}>
    <span className="visually-hidden" data-testid="active-path">{path}</span>
    <div className="visually-hidden" role="status" aria-live="polite" data-testid="save-status">{status}</div>
    {notice && <div className={`notice ${conflict ? 'notice-conflict' : ''}`} role="alert"><span>{notice}</span>{conflict ? <button onClick={() => void useDiskRef.current()}>Use disk version</button> : <button onClick={() => void saveRef.current().catch(error => setNotice(error.message))}>Retry</button>}</div>}
    <section className={`canvas-region ${path ? '' : 'canvas-empty'}`} aria-label="Drawing editor">
      <Excalidraw excalidrawAPI={setApi} onChange={(elements, state, files) => changedRef.current(elements, state, files)} initialData={{ libraryItems: readLibrary() }} onLibraryChange={items => { try { localStorage.setItem('exact-draw-library', JSON.stringify(items)); } catch { setNotice('The library could not be saved locally. Export the library to keep a copy.'); } }} viewModeEnabled={conflict || loading || !path} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true } } }}>
        <MainMenu><MainMenu.DefaultItems.Export /><MainMenu.DefaultItems.SaveAsImage /><MainMenu.Separator /><MainMenu.DefaultItems.SearchMenu /><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ToggleTheme /><MainMenu.DefaultItems.ChangeCanvasBackground /><MainMenu.Separator /><MainMenu.DefaultItems.Help /></MainMenu>
      </Excalidraw>
      {!path && <div className="empty-state"><img className="brand-mark" src="/assets/logo.png" alt="" /><p className="eyebrow">EXACT DRAW</p><h1>A canvas for your thinking.</h1><p>Open an <strong>.excalidraw</strong> file or a folder in the sidebar.<br />Your drawings stay on your filesystem, ready for you and your agents.</p><div className="empty-details"><span>Edits save automatically</span><span>External changes appear here</span></div></div>}
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Editor />);
