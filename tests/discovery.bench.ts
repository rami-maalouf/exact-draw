import { mkdir, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startService } from '../service/server';

const root = await realpath(await mkdtemp(join(tmpdir(), 'draw-benchmark-')));
const scene = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} });
let service: Awaited<ReturnType<typeof startService>> | undefined;
try {
  for (let folder = 0; folder < 100; folder++) {
    const dir = join(root, `folder-${folder}`), ignored = join(root, 'node_modules', `package-${folder}`);
    await mkdir(dir, { recursive: true }); await mkdir(ignored, { recursive: true });
    await Promise.all(Array.from({ length: 50 }, async (_, index) => {
      await writeFile(join(dir, `${index}.excalidraw`), scene);
      await writeFile(join(ignored, `${index}.js`), 'ignored');
    }));
  }
  const sparse = await open(join(root, 'unrelated-video.bin'), 'w');
  await sparse.truncate(4 * 1024 ** 3); await sparse.close();
  service = await startService({ port: 0, stateDirectory: join(root, 'state') });
  await service.open(join(root, 'folder-0/0.excalidraw'));
  const url = `http://127.0.0.1:${service.server.port}`;
  const headers = { authorization: `Bearer ${service.token}` };
  const start = performance.now();
  await service.open(root);
  const latencies: number[] = [];
  let state;
  do {
    const before = performance.now();
    const response = await fetch(`${url}/api/document`, { headers });
    const document = await response.json();
    latencies.push(performance.now() - before);
    if (!document.snapshot.path.endsWith('/folder-0/0.excalidraw')) throw new Error('The active drawing changed during discovery.');
    state = await fetch(`${url}/api/workspace`, { headers }).then(r => r.json());
    if (performance.now() - start > 10000) throw new Error('Discovery exceeded the benchmark deadline.');
  } while (state.scanning);
  if (state.scanCount !== 5000) throw new Error(`Expected 5000 drawings, found ${state.scanCount}`);
  latencies.sort((a,b) => a-b);
  const result = { drawingFiles: 5000, ignoredDependencyFiles: 5000, unrelatedSparseFileGiB: 4, discoveryMs: Math.round(performance.now() - start), documentRequests: latencies.length, documentRequestP95Ms: Number(latencies[Math.floor(latencies.length * 0.95)].toFixed(2)), documentRequestMaxMs: Number(latencies.at(-1)!.toFixed(2)), activeDrawingPreserved: true };
  await mkdir(join(import.meta.dir, '../.exact'), { recursive: true });
  await writeFile(join(import.meta.dir, '../.exact/discovery-benchmark.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { service?.stop(); await rm(root, { recursive: true, force: true }); }
