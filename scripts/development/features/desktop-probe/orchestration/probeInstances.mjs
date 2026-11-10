import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultOptions, ProbeError, repoRoot } from '../definitions/probeContract.mjs';
import { waitFor } from '../infrastructure/cdpClient.mjs';
import { cloneWorkspaceData } from '../infrastructure/workspaceClone.mjs';
import { buildFreshness, ensureFreshBuild } from './probeBuild.mjs';
import {
  instanceRoot, instancesRoot, prepareInstance, readSession, touchInstance, withLifecycleLock, writeSession,
} from '../infrastructure/instanceStore.mjs';
import { observeTree, readProcessTable, sameProcess, signalOwner, stopOwnedTree } from '../infrastructure/processTree.mjs';

const supervisorEntry = fileURLToPath(new URL('./probeSupervisor.mjs', import.meta.url));

function sessionSummary(session) {
  // 子进程的完整命令只用于核对归属，留在实例目录，避免进入工具输出。
  const summary = { ...session };
  delete summary.processes;
  return summary;
}

export function probeStatus(name) {
  const root = instanceRoot(name);
  const current = readSession(root);
  if (!current) return { state: 'stopped', root };
  const session = sessionSummary(current);
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

function checkSupervisorHandoff(session) {
  if (session?.state === 'starting' && !session.supervisor && Date.now() - session.startedAt < 45_000) {
    throw new ProbeError('BUSY', '看管进程正在发布启动身份');
  }
}

async function recoverOrphaned(root, session) {
  if (!session || (session.cleanup?.remaining.length === 0 && session.failure?.code !== 'STOP_FAILED')) {
    return session?.cleanup;
  }
  const table = readProcessTable();
  const desktop = observeTree(session.electron, table);
  const vite = observeTree(session.vite, table);
  const observed = new Map((session.processes ?? []).map(entry => [entry.pid, entry]));
  for (const [pid, entry] of desktop) observed.set(pid, entry);
  for (const [pid, entry] of vite) observed.set(pid, entry);

  await stopOwnedTree(session.electron, desktop);
  for (const [pid, entry] of desktop) observed.set(pid, entry);
  const cleanup = await stopOwnedTree(undefined, observed, 120);
  const failure = cleanup.remaining.length ? { code: 'STOP_FAILED', message: '探针仍有自有进程未退出' } : undefined;
  writeSession(root, {
    ...session, processes: [...observed.values()], state: failure ? 'failed' : 'stopped',
    cleanup, failure, stopReason: 'owner-exited', stoppedAt: Date.now(),
  });
  if (failure) throw new ProbeError(failure.code, failure.message, session.logs.supervisor);
  return cleanup;
}

async function start(root, options, { fresh = false, noBuild = false, cloneData } = {}) {
  const previous = readSession(root);
  checkSupervisorHandoff(previous);
  if (sameProcess(previous?.supervisor)) {
    if (fresh || cloneData) throw new ProbeError('BUSY', '请先停止当前实例再使用 --fresh 或 --clone-data');
    touchInstance(root);
    if (previous.state === 'ready') {
      // 复用旧实例时，源码可能已在其启动后变化；只提示，不打断正在使用它的人。
      const freshness = previous.options?.entry === 'toy' ? { stale: false } : buildFreshness();
      return { ...sessionSummary(previous), reused: true, ...(freshness.stale && {
        buildStale: freshness.reason, hint: '运行 pnpm -s probe restart 以载入新构建',
      }) };
    }
    throw new ProbeError('BUSY', '实例正在启动或停止');
  }
  await recoverOrphaned(root, previous);
  const build = options.entry === 'toy' ? {} : {
    build: await ensureFreshBuild({ build: !noBuild }),
    gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  };
  if (fresh) rmSync(root, { recursive: true, force: true });
  prepareInstance(root);
  const dataClone = cloneData ? await cloneWorkspaceData(cloneData, join(root, 'workspace')) : undefined;
  const logs = Object.fromEntries(['desktop', 'vite', 'renderer', 'supervisor'].map(source => [
    source, join(root, 'logs', `${source}.${source === 'renderer' ? 'jsonl' : 'log'}`),
  ]));
  const session = {
    state: 'starting', options, root, repoRoot, logs, startedAt: Date.now(), ...build, ...(dataClone && { dataClone }),
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
      return current.state === 'ready' && { ...sessionSummary(current), reused: false };
    }, '探针启动', 45_000);
  } catch (error) {
    const owner = readSession(root)?.supervisor;
    if (owner?.pid === child.pid) signalOwner(owner, 'SIGTERM');
    throw error;
  }
}

async function stop(root, clean) {
  const session = readSession(root);
  checkSupervisorHandoff(session);
  if (sameProcess(session?.supervisor)) {
    signalOwner(session.supervisor, 'SIGTERM');
    await waitFor(() => !sameProcess(session.supervisor), '探针退出', 22_000);
  }
  const cleanup = await recoverOrphaned(root, readSession(root));
  if (clean) rmSync(root, { recursive: true, force: true });
  return { state: 'stopped', root, cleanup };
}

export function changeProbeInstance(command, options, {
  fresh = false, clean = false, 'no-build': noBuild = false, 'clone-data': cloneData,
} = {}) {
  const root = instanceRoot(options.name);
  return withLifecycleLock(root, async () => {
    if (command === 'stop') return stop(root, clean);
    if (command === 'restart') {
      const old = readSession(root);
      await stop(root, false);
      return start(root, { ...defaultOptions, ...old?.options, ...options }, { fresh, noBuild });
    }
    return start(root, { ...defaultOptions, ...options }, { fresh, noBuild, cloneData });
  });
}

export function requireReady(name) {
  const session = probeStatus(name);
  if (session.state !== 'ready' || !sameProcess(session.electron)) {
    throw new ProbeError('NOT_RUNNING', '该探针实例没有就绪', '运行 pnpm -s probe up');
  }
  return session;
}
