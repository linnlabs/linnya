import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const runtime = await mkdtemp(path.join(tmpdir(), 'linnya-menu-browser-'));
const server = await createServer({
  configFile: false,
  root: path.join(packageRoot, 'tests/browser'),
  plugins: [vue()],
  resolve: { dedupe: ['vue'] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [packageRoot] } },
});
try {
  await server.listen();
  const child = spawn(
    electron,
    [
      path.join(packageRoot, 'tests/browser/menuBrowser.cjs'),
      server.resolvedUrls.local[0],
      runtime,
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
      timeout: 120_000,
    }
  );
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`Menu browser checks exited ${code}`);
} finally {
  await server.close();
  await rm(runtime, { recursive: true, force: true });
}
