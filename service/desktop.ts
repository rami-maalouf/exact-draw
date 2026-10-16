import { join } from 'node:path';
import { startService } from './server';

const service = await startService({
  workerPath: join(import.meta.dir, 'scan-worker.js'),
  editorDirectory: join(import.meta.dir, 'editor'),
});
const parent = Number(process.env.EXACT_DRAW_PARENT_PID);
const monitor = setInterval(() => {
  try { process.kill(parent, 0); }
  catch { stop(); }
}, 1000);
function stop() {
  clearInterval(monitor);
  service.stop();
  process.exit();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stop);
console.log('EXACT_DRAW_READY');
