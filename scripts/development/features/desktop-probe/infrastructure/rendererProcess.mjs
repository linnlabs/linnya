import { fork } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { waitFor } from './cdpClient.mjs';

const entry = fileURLToPath(new URL('../runtime/probeVite.mjs', import.meta.url));

export async function startIsolatedRenderer({ cacheDir, logPath, port = 5175 }) {
  const log = logPath ? openSync(logPath, 'w', 0o600) : 'inherit';
  let child;
  try {
    child = fork(entry, [repoRoot, cacheDir, String(port)], { cwd: repoRoot, stdio: ['ignore', log, log, 'ipc'] });
  } finally {
    if (typeof log === 'number') closeSync(log);
  }
  const ready = Promise.withResolvers();
  const exited = Promise.withResolvers();
  child.once('message', message => ready.resolve(message.url));
  child.once('error', error => { ready.reject(error); exited.resolve(); });
  child.once('exit', code => {
    ready.reject(new ProbeError('START_FAILED', `Vite 提前退出（${code}）`, logPath));
    exited.resolve();
  });
  const close = async () => {
    if (child.connected) child.disconnect();
    await waitFor(() => child.exitCode !== null || child.signalCode !== null || !child.pid, 'Vite 退出', 3_000);
  };
  const timer = setTimeout(() => ready.reject(new ProbeError('TIMEOUT', 'Vite 未就绪', logPath)), 15_000);
  try {
    return { child, url: await ready.promise, close, exited: exited.promise };
  } catch (error) {
    if (child.connected) child.disconnect();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
