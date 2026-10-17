import { useEffect, useRef, useState } from 'react';
import { exportToSvg, restore } from '@excalidraw/excalidraw';
import { request } from './api';

export type DocumentAction = { action: string; destination?: string; name?: string; id?: string; checkpointId?: string };
export type Panel = 'history' | 'trash' | 'rename' | 'delete';
type Revision = { id: string; createdAt: string; source: string; version: string };
type Trashed = { id: string; path: string; name: string; deletedAt: string };
const date = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const title = (path: string) => path.split('/').pop()?.replace(/\.excalidraw$/, '') ?? '';

export function DocumentsPanel({ panel, path, perform, dismiss }: {
  panel: Panel;
  path: string;
  perform: (action: DocumentAction) => Promise<void>;
  dismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [trash, setTrash] = useState<Trashed[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState(title(path));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewReady, setPreviewReady] = useState(false);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    let disposed = false;
    setError(''); setLoading(true);
    const load = async () => {
      if (panel === 'history') {
        const result = await request<{ entries: Revision[] }>(`/api/history?path=${encodeURIComponent(path)}`);
        if (!disposed) { setRevisions(result.entries); setSelected(result.entries[0]?.id ?? ''); }
      } else if (panel === 'trash') {
        const result = await request<{ entries: Trashed[] }>('/api/trash');
        if (!disposed) setTrash(result.entries);
      }
    };
    void load().catch(reason => { if (!disposed) setError(reason.message); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [panel, path, generation]);

  useEffect(() => {
    let disposed = false;
    setPreviewReady(false);
    preview.current?.replaceChildren();
    if (!selected || panel !== 'history') return;
    void (async () => {
      const snapshot = await request<{ document: Parameters<typeof restore>[0] }>(`/api/history/preview?path=${encodeURIComponent(path)}&id=${encodeURIComponent(selected)}`);
      const restored = restore(snapshot.document, null, null);
      const svg = await exportToSvg({ elements: restored.elements, files: restored.files, appState: { ...restored.appState, exportBackground: true, exportWithDarkMode: false } });
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Version preview');
      if (!disposed && preview.current) { preview.current.replaceChildren(svg); setPreviewReady(true); }
    })().catch(reason => { if (!disposed) setError(reason.message); });
    return () => { disposed = true; };
  }, [selected, panel, path]);

  const run = async (action: DocumentAction, close = true) => {
    setBusy(true); setError('');
    try { await perform(action); if (close) dismiss(); else setGeneration(value => value + 1); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const heading = panel === 'history' ? 'Version history' : panel === 'trash' ? 'Trash' : panel === 'rename' ? 'Rename drawing' : 'Move drawing to Trash?';

  return <dialog ref={dialog} className={`documents-dialog documents-${panel}`} aria-labelledby="documents-heading" onCancel={event => { event.preventDefault(); if (!busy) dismiss(); }}>
    <header className="documents-header"><div><h2 id="documents-heading">{heading}</h2><p>{panel === 'trash' ? 'Drawings stay here until you restore them.' : title(path)}</p></div><button className="quiet-button" onClick={dismiss} disabled={busy} aria-label="Close dialog">Close</button></header>
    {error && <p className="documents-error" role="alert">{error}</p>}
    {panel === 'history' && <>
      <p className="documents-caption">The latest 50 versions are kept. Restoring adds a new version and keeps your current work in history.</p>
      <div className="history-layout">
        <div className="history-versions" aria-label="Versions">{loading ? <p>Loading versions…</p> : revisions.length === 0 ? <p>No saved versions yet.</p> : revisions.map((revision, index) => <button key={revision.id} className={`history-version ${selected === revision.id ? 'selected' : ''}`} aria-pressed={selected === revision.id} onClick={() => { setSelected(revision.id); setError(''); }} disabled={busy}>
          <strong>{date(revision.createdAt)}</strong><span>{revision.source.replace(/-/g, ' ')}{index === 0 ? ' · Latest' : ''}</span>
        </button>)}</div>
        <div className="history-preview" aria-busy={!!selected && !previewReady}><div ref={preview} />{selected && !previewReady && !error && <span>Preparing preview…</span>}</div>
      </div>
      <footer className="documents-footer"><button onClick={() => void run({ action: 'checkpoint' }, false)} disabled={busy || loading}>Keep a checkpoint</button><button className="primary-button" onClick={() => void run({ action: 'restore-history', checkpointId: selected })} disabled={busy || !previewReady}>Restore this version</button></footer>
    </>}
    {panel === 'trash' && <div className="trash-list">{loading ? <p>Loading Trash…</p> : trash.length === 0 ? <p className="documents-empty">Trash is empty.</p> : trash.map(item => <article className="trash-item" key={item.id}><div><strong>{title(item.name)}</strong><span title={item.path}>{item.path}</span><small>Moved to Trash {date(item.deletedAt)}</small>
      <details><summary>Restore to another location</summary><form onSubmit={event => {
        event.preventDefault();
        const destination = new FormData(event.currentTarget).get('destination') as string;
        void run({ action: 'restore-trash', id: item.id, destination }, false);
      }}><label>Full destination path<input name="destination" aria-label={`Restore destination for ${title(item.name)}`} defaultValue={item.path} required disabled={busy} /></label><p className="documents-caption">Choose an existing folder and include the .excalidraw filename. Existing files will not be replaced.</p><button disabled={busy}>Restore here</button></form></details>
    </div><button onClick={() => void run({ action: 'restore-trash', id: item.id }, false)} disabled={busy}>Restore</button></article>)}</div>}
    {panel === 'rename' && <form onSubmit={event => { event.preventDefault(); void run({ action: 'rename', name: name.trim() }); }}><label className="rename-label">Drawing name<input autoFocus aria-label="Drawing name" value={name} onChange={event => setName(event.target.value)} disabled={busy} required /></label><p className="documents-caption">The file keeps its version history. The .excalidraw extension is added automatically.</p><footer className="documents-footer"><button type="button" onClick={dismiss} disabled={busy}>Cancel</button><button className="primary-button" disabled={busy || !name.trim()}>Rename</button></footer></form>}
    {panel === 'delete' && <><p className="documents-caption">The drawing will leave its folder. You can restore it, together with its history, from Exact Draw’s Trash.</p><footer className="documents-footer"><button onClick={dismiss} disabled={busy}>Cancel</button><button className="danger-button" onClick={() => void run({ action: 'trash' })} disabled={busy}>Move to Trash</button></footer></>}
  </dialog>;
}
