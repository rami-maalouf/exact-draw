const bun = process.execPath;
for (const args of [['test', 'service'], ['x', '--no-install', 'tsc', '--noEmit'], ['exact.mjs', 'contract', 'build', 'app.contract', '--json']]) {
  const child = Bun.spawn([bun, ...args], { stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code) process.exit(code);
}
