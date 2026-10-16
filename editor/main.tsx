import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureUpdateAction, Excalidraw, MainMenu, restore, serializeAsJSON } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI, LibraryItems } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { request, RequestError, token } from './api';
import { DocumentsPanel, type DocumentAction, type Panel } from './DocumentsPanel';
import './style.css';

type Drawing = { type: 'excalidraw'; version: number; elements: ExcalidrawElement[]; appState: Partial<AppState>; files: BinaryFiles };
type Snapshot = { id: string; path: string; version: string; document: Drawing };
type Status = 'Opening' | 'Saved' | 'Unsaved' | 'Saving' | 'Offline' | 'Conflict';
const parameters = new URLSearchParams(location.search);
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const contentKey = (document: Drawing) => stable({ elements: document.elements, appState: document.appState, files: document.files });
function readLibrary(): LibraryItems { try { return JSON.parse(localStorage.getItem('exact-draw-library') ?? '[]'); } catch { return []; } }

function Editor() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [path, setPath] = useState('');
  const [status, setStatus] = useState<Status>('Opening');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const panelOpen = useRef<Panel | null>(null);
  const showPanel = (next: Panel | null) => { panelOpen.current = next; setPanel(next); };
  const panelPath = useRef('');
  const performRef = useRef<(action: DocumentAction) => Promise<void>>(async () => { throw new Error('The editor is still opening.'); });
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const useDiskRef = useRef<() => Promise<void>>(async () => {});
  const changedRef = useRef<(elements: readonly ExcalidrawElement[], state: AppState, files: BinaryFiles) => void>(() => {});
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!api) return;
    const editor = api;
    let disposed = false, current: Snapshot | null = null, latest: Drawing | null = null, savedKey = '', latestKey = '', applying = false;
    let blocked = false, externalError = '', recovering = false;
    let changingDocument = false, processingCommand = false;
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
      const sameFile = current?.id === snapshot.id;
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
      if (changingDocument) { refreshAgain = true; return; }
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
            if (!next) {
              if (dirtyRef.current && !(await save())) return;
              if (current) clearCanvas();
              else { setStatus('Saved'); setNotice(''); }
              return;
            }
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
    function clearCanvas() {
      applying = true;
      clearTimeout(timer);
      editor.resetScene(); editor.history.clear();
      current = null; latest = null; savedKey = ''; latestKey = ''; dirtyRef.current = false;
      setPath(''); setStatus('Saved'); setNotice('');
      applying = false;
    }
    async function perform(action: DocumentAction) {
      if (changingDocument) throw new Error('Wait for the current file action to finish.');
      changingDocument = true; setWorking(true);
      try {
        if (refreshing) await refreshing;
        if (saving) await saving;
        let recovery = '';
        const leaving = ['new', 'open', 'reopen', 'close'].includes(action.action);
        const needsRecovery = blocked || externalError || !(await save());
        let expected = current;
        if (needsRecovery) {
          if (!leaving) throw new Error('Resolve the drawing’s save warning before changing files. Your current canvas has been kept.');
          if (dirtyRef.current || blocked) recovery = await preserve();
          expected = (await request<{ snapshot: Snapshot | null }>('/api/document')).snapshot;
        }
        const previousPath = current?.path;
        const result = await request<{ snapshot: Snapshot | null }>('/api/lifecycle', { ...action, path: expected?.path, version: expected?.version });
        if (result.snapshot) {
          if (result.snapshot.path !== current?.path || result.snapshot.version !== current?.version) await apply(result.snapshot);
          else current = result.snapshot;
        } else clearCanvas();
        blocked = false; externalError = ''; uncertainSave = null; setConflict(false);
        if (previousPath) clearDraft(previousPath);
        setNotice(recovery ? `Your previous edits were preserved in ${recovery}.` : '');
      } finally {
        changingDocument = false; setWorking(false);
        if (refreshAgain) void refresh();
      }
    }
    performRef.current = perform;
    async function handleCommand() {
      if (processingCommand || disposed || panelOpen.current) return;
      processingCommand = true;
      try {
        for (;;) {
          if (panelOpen.current) break;
          const { command } = await request<{ command: DocumentAction | null }>('/api/command/take', {});
          if (!command || disposed) break;
          if (command.action === 'history' || command.action === 'rename' || command.action === 'trash') {
            if (!current) throw new Error('Open a drawing first.');
            if (command.action === 'history' && !(await save())) throw new Error('Save your latest changes before opening history.');
            panelPath.current = current.path;
            showPanel(command.action === 'trash' ? 'delete' : command.action);
          } else if (command.action === 'show-trash') {
            panelPath.current = current?.path ?? ''; showPanel('trash');
          } else await perform(command);
        }
      } catch (reason) { setNotice((reason as Error).message); }
      finally { processingCommand = false; }
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
    events.addEventListener('command', () => { void handleCommand(); });
    events.onopen = () => { void refresh().then(handleCommand); };
    events.onerror = () => { if (!blocked) { setStatus('Offline'); setNotice('Connection interrupted. Your canvas is kept here while the file service reconnects.'); } };
    const commandPoll = setInterval(() => { void handleCommand(); }, 1000);
    const wake = () => { if (document.visibilityState !== 'hidden') void request('/api/sync', {}).then(refresh).catch(() => { setStatus('Offline'); }); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('focus', wake); document.addEventListener('visibilitychange', wake); window.addEventListener('beforeunload', beforeUnload);
    void refresh().then(handleCommand);
    return () => { disposed = true; clearTimeout(timer); clearTimeout(eventTimer); clearInterval(commandPoll); events.close(); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', wake); window.removeEventListener('beforeunload', beforeUnload); };
  }, [api]);

  const command = (action: string) => { void request('/api/command', { action }).catch(reason => setNotice(reason.message)); };

  return <main className={`editor-shell${parameters.get('titlebar') === 'overlay' ? ' editor-shell-overlay' : ''}${notice ? ' editor-shell-notice' : ''}`}>
    <span className="visually-hidden" data-testid="active-path">{path}</span>
    <div className="visually-hidden" role="status" aria-live="polite" data-testid="save-status">{status}</div>
    {notice && <div className={`notice ${conflict ? 'notice-conflict' : ''}`} role="alert"><span>{notice}</span>{conflict ? <button onClick={() => void useDiskRef.current()}>Use disk version</button> : <button onClick={() => void saveRef.current().catch(error => setNotice(error.message))}>Retry</button>}</div>}
    <section className={`canvas-region ${path ? '' : 'canvas-empty'}`} aria-label="Drawing editor">
      <Excalidraw excalidrawAPI={setApi} onChange={(elements, state, files) => changedRef.current(elements, state, files)} initialData={{ libraryItems: readLibrary() }} onLibraryChange={items => { try { localStorage.setItem('exact-draw-library', JSON.stringify(items)); } catch { setNotice('The library could not be saved locally. Export the library to keep a copy.'); } }} viewModeEnabled={conflict || loading || working || !path} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: true } } }}>
        <MainMenu>
          <MainMenu.Item onSelect={() => command("history")} disabled={!path || working}>Version history</MainMenu.Item>
          <MainMenu.Item onSelect={() => command("rename")} disabled={!path || working}>Rename drawing…</MainMenu.Item>
          <MainMenu.Item onSelect={() => command("duplicate")} disabled={!path || working}>Duplicate drawing</MainMenu.Item>
          <MainMenu.Item onSelect={() => command("trash")} disabled={!path || working}>Move to Trash…</MainMenu.Item>
          <MainMenu.Item onSelect={() => command("close")} disabled={!path || working}>Close drawing</MainMenu.Item>
          <MainMenu.Separator /><MainMenu.DefaultItems.Export /><MainMenu.DefaultItems.SaveAsImage /><MainMenu.Separator /><MainMenu.DefaultItems.SearchMenu /><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ToggleTheme /><MainMenu.DefaultItems.ChangeCanvasBackground /><MainMenu.Separator /><MainMenu.DefaultItems.Help /></MainMenu>
      </Excalidraw>
      {!path && <div className="empty-state"><img className="brand-mark" src="/assets/logo.png" alt="" /><p className="eyebrow">EXACT DRAW</p><h1>A canvas for your thinking.</h1><p>Open an <strong>.excalidraw</strong> file or a folder in the sidebar.<br />Your drawings stay on your filesystem, ready for you and your agents.</p><div className="empty-details"><span>Edits save automatically</span><span>External changes appear here</span></div></div>}
    </section>
    {panel && <DocumentsPanel key={panel + ":" + panelPath.current} panel={panel} path={panelPath.current} dismiss={() => showPanel(null)} perform={async action => {
      if (panel !== "trash" && path !== panelPath.current) throw new Error("The active drawing changed. Close this dialog and try again.");
      await performRef.current(action);
    }} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Editor />);
