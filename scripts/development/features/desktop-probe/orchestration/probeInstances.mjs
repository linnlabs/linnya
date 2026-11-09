import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultOptions, ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { waitFor } from '../infrastructure/cdpClient.mjs';
import {
  instanceRoot, instancesRoot, prepareInstance, readSession, touchInstance, withLifecycleLock, writeSession,
} from '../infrastructure/instanceStore.mjs';
import { sameProcess, signalOwner } from '../infrastructure/processTree.mjs';

const supervisorEntry = fileURLToPath(new URL('./probeSupervisor.mjs', import.meta.url));
const dist = join(repoRoot, 'dist/main/main.cjs');

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function buildStatus() {
  for (const file of [dist, join(repoRoot, 'dist/main/preload.js'), join(repoRoot, 'dist/main/app-server-backend.cjs')]) {
    if (!existsSync(file)) throw new ProbeError('BUILD_MISSING', `缺少 ${file}`, '先运行 pnpm run dev:electron --build-only');
  }
  const distMtime = statSync(dist).mtimeMs;
  const sourceChanges = git('status', '--porcelain', '--', 'src', 'packages').split('\n')
    .filter(Boolean).map(line => line.slice(3).split(' -> ').at(-1));
  const distStale = Number(git('log', '-1', '--format=%ct', '--', 'src', 'packages')) * 1000 > distMtime ||
    sourceChanges.some(file => (statSync(join(repoRoot, file), { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) > distMtime);
  return { distMtime, distStale, gitHead: git('rev-parse', 'HEAD') };
}

export function probeStatus(name) {
  const root = instanceRoot(name);
  const session = readSession(root);
  if (!session) return { state: 'stopped', root };
  if (['starting', 'ready'].includes(session.state) && session.supervisor && !sameProcess(session.supervisor)) {
    return { ...session, state: 'failed', failure: { code: 'OWNER_EXITED', message: '探针看管进程已退出' } };
  }
  if (session.state === 'ready') touchInstance(root);
  return session;
}

export function listProbes() {
  if (!existsSync(instancesRoot)) return [];
  return readdirSync(instancesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.endsWith('.lock'))
    .map(entry => probeStatus(entry.name));
}

async function start(root, options, fresh) {
  const previous = readSession(root);
  if (previous?.state === 'starting' && !previous.supervisor && Date.now() - previous.startedAt < 45_000) {
    throw new ProbeError('BUSY', '看管进程正在发布启动身份');
  }
  if (sameProcess(previous?.supervisor)) {
    if (fresh) throw new ProbeError('BUSY', '请先停止当前实例再使用 --fresh');
    touchInstance(root);
    if (previous.state === 'ready') return { ...previous, reused: true };
    throw new ProbeError('BUSY', '实例正在启动或停止');
  }
  if (sameProcess(previous?.electron) || previous?.cleanup?.remaining?.length || previous?.failure?.code === 'STOP_FAILED') {
    throw new ProbeError('STOP_FAILED', '上次探针未完成进程清理', '检查该实例的 supervisor.log');
  }
  const build = options.entry === 'toy' ? {} : buildStatus();
  if (fresh) rmSync(root, { recursive: true, force: true });
  prepareInstance(root);
  const logs = Object.fromEntries(['desktop', 'vite', 'renderer', 'supervisor'].map(source => [
    source, join(root, 'logs', `${source}.${source === 'renderer' ? 'jsonl' : 'log'}`),
  ]));
  const session = {
    state: 'starting', options, root, repoRoot, logs, startedAt: Date.now(), ...build,
    // Chromium 的界面偏好按 origin 保存，重启时优先复用本实例的端口。
    preferredRendererPort: !fresh && previous?.viteUrl ? Number(new URL(previous.viteUrl).port) : undefined,
    connectionFile: join(root, 'runtime', 'conversation-control-v1.json'),
  };
  writeSession(root, session);
  const fd = openSync(logs.supervisor, 'w', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [supervisorEntry, root], {
      cwd: repoRoot, detached: true, stdio: ['ignore', fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  let launchError;
  child.once('error', error => { launchError = error.message; });
  child.unref();

  try {
    return await waitFor(() => {
      const current = readSession(root);
      if (current.state === 'failed') throw new ProbeError(current.failure.code, current.failure.message, logs.supervisor);
      if (launchError || child.exitCode !== null || child.signalCode !== null) {
        throw new ProbeError('START_FAILED', launchError ?? '看管进程提前退出', logs.supervisor);
      }
      return current.state === 'ready' && { ...current, reused: false };
    }, '探针启动', 45_000);
  } catch (error) {
    const owner = readSession(root)?.supervisor;
    if (owner?.pid === child.pid) signalOwner(owner, 'SIGTERM');
    throw error;
  }
}

async function stop(root, clean) {
  const session = readSession(root);
  const requested = sameProcess(session?.supervisor);
  if (requested) {
    signalOwner(session.supervisor, 'SIGTERM');
    await waitFor(() => !sameProcess(session.supervisor), '探针退出', 22_000);
  }
  const finished = readSession(root);
  if (requested && !['stopped', 'failed'].includes(finished?.state)) {
    throw new ProbeError('STOP_FAILED', '看管进程退出前未发布清理结果', session.logs.supervisor);
  }
  if (sameProcess(finished?.electron) || finished?.cleanup?.remaining?.length || finished?.failure?.code === 'STOP_FAILED') {
    throw new ProbeError('STOP_FAILED', '探针仍有自有进程未退出', finished.logs.supervisor);
  }
  if (clean) rmSync(root, { recursive: true, force: true });
  return { state: 'stopped', root, cleanup: finished?.cleanup };
}

export function changeProbeInstance(command, options, { fresh = false, clean = false } = {}) {
  const root = instanceRoot(options.name);
  return withLifecycleLock(root, async () => {
    if (command === 'stop') return stop(root, clean);
    if (command === 'restart') {
      const old = readSession(root);
      await stop(root, false);
      return start(root, { ...defaultOptions, ...old?.options, ...options }, fresh);
    }
    return start(root, { ...defaultOptions, ...options }, fresh);
  });
}

export function requireReady(name) {
  const session = probeStatus(name);
  if (session.state !== 'ready' || !sameProcess(session.electron)) {
    throw new ProbeError('NOT_RUNNING', '该探针实例没有就绪', '运行 pnpm -s probe up');
  }
  return session;
}
