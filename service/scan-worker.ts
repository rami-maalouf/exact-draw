import { scan } from './scanner';
self.onmessage = async (event: MessageEvent<{ root: string }>) => {
  try {
    await scan(event.data.root, paths => postMessage({ paths }), error => postMessage({ error }));
    postMessage({ done: true });
  } catch (error) { postMessage({ error: String(error), done: true }); }
};
