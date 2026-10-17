import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { startService } from '../service/server';

export async function createShellFixture() {
  const source = resolve(import.meta.dir, '..');
  const app = await realpath(await mkdtemp(join(dirname(source), 'exact-draw-shell-fixture-')));
  const suffix = basename(app).replace('exact-draw-shell-fixture-', '').toLowerCase();
  const name = `Exact Draw Shell ${suffix}`;
  const id = `com.example.exact-draw-shell.${suffix}`;
  const dataDirectory = await realpath(await mkdtemp(join(tmpdir(), 'exact-draw-shell-data-')));
  let nativeBundle: string | undefined;
  const excluded = new Set(['.git', '.exact', 'target', 'node_modules', 'native-server', 'output']);
  await cp(source, app, { recursive: true, filter: path => !excluded.has(relative(source, path).split('/')[0]!) });
  await symlink(join(source, 'node_modules'), join(app, 'node_modules'), 'dir');
  await mkdir(dataDirectory, { recursive: true });
  const options = { port: 0, stateDirectory: join(dataDirectory, 'state'), testLoopbackOrigins: true, editorDirectory: join(app, 'dist/editor') };
  let service = await startService(options);
  options.port = service.server.port!;
  const api = `http://127.0.0.1:${options.port}`;
  const module = await readFile(join(app, 'app.ts'), 'utf8');
  await writeFile(join(app, 'app.ts'), module.replace('http://127.0.0.1:47931', api).replace(/export const appId = '[^']+';/, `export const appId = '${id}';`));
  const manifest = JSON.parse(await readFile(join(app, 'app.json'), 'utf8'));
  Object.assign(manifest, { name, short_name: name, id });
  Object.assign(manifest.app, { name, id });
  await writeFile(join(app, 'app.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // standalone fixture launches must retain the isolated port and storage too.
  const desktop = await readFile(join(app, 'service/desktop.ts'), 'utf8');
  await writeFile(join(app, 'service/desktop.ts'), desktop.replace('startService({', `startService({ port: ${options.port}, stateDirectory: ${JSON.stringify(options.stateDirectory)}, testLoopbackOrigins: true,`));
  const nativeModule = join(app, 'macos/modules/FileChooser.swift');
  await writeFile(nativeModule, (await readFile(nativeModule, 'utf8')).replace('Library/Logs/Exact Draw', `Library/Logs/${name}`));
  const env = { ...Bun.env, EXACT2: Bun.env.EXACT2 ?? resolve(source, '../exact2'), CHROME: Bun.env.CHROME ?? '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' };
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, ...args], { cwd: app, stdout: 'inherit', stderr: 'inherit', env });
    const code = await child.exited;
    if (code) throw new Error(`Fixture command failed (${code}): ${args.join(' ')}`);
  }
  return {
    app, dataDirectory, api, env, run,
    get nativeBundle() { return nativeBundle; },
    get service() { return service; },
    async restart() { await service.stop(); service = await startService(options); },
    async buildNative() {
      await run(['scripts/package-macos.ts']);
      // source remains beside exact2; launch previews outside protected documents.
      const bundles: string[] = [];
      for await (const path of new Bun.Glob('target/clients/*/*/macos/*.app').scan({ cwd: app, onlyFiles: false })) bundles.push(path);
      if (bundles.length !== 1) throw new Error(`Expected one fixture app bundle, found ${bundles.length}.`);
      nativeBundle = join(dataDirectory, `${name}.app`);
      await cp(join(app, bundles[0]!), nativeBundle, { recursive: true });
    },
    async dispose(keep = false) {
      await service.stop();
      if (keep) console.log(`Retained isolated shell fixture: ${app}\nService: ${api}\nState: ${options.stateDirectory}\nNative preview: ${nativeBundle ?? 'not built'}`);
      else { await rm(app, { recursive: true, force: true }); await rm(dataDirectory, { recursive: true, force: true }); }
    },
  };
}
