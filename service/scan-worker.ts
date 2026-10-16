import { scan } from './scanner';
self.onmessage = async (event: MessageEvent<{ roots: string[] }>) => {
  try {
    for (const root of event.data.roots) {
      await scan(root, paths => postMessage({ root, paths }), error => postMessage({ root, error }));
    }
    postMessage({ done: true });
  } catch (error) { postMessage({ error: String(error), done: true }); }
};
