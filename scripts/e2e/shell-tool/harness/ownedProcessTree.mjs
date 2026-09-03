import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { createIsolatedRunRoot } from './isolatedRunRoot.mjs';
import {
  assertHeartbeatStopped,
  isProcessAlive,
  wait,
  waitForHeartbeatProgress,
  waitForProcessTreeEvidence,
  waitForProcessesExited,
} from './processObservation.mjs';

const fixturePath = fileURLToPath(new URL('../fixtures/process-trees/owned-tree.cjs', import.meta.url));

async function waitForStartupEvidence(startupEvidencePath, runToken) {
  let entry;
  try {
    entry = await stat(startupEvidencePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!entry.isFile()) throw new Error('启动证据路径不是普通文件');
  return waitForProcessTreeEvidence(
    startupEvidencePath,
    runToken,
    () => undefined,
  );
}

function observeChildProcess(child) {
  let launchError;
  let closeOutcome;
  const closePromise = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      closeOutcome = { kind: 'close', code, signal };
      resolve(closeOutcome);
    });
  });
  child.once('error', error => {
    launchError = { kind: 'spawn_error', error };
  });
  return {
    closePromise,
    readClose: () => closeOutcome,
    readReadinessFailure: () => launchError ?? closeOutcome,
  };
}

async function waitForProcessClose(observation, timeoutMs) {
  const current = observation.readClose();
  if (current) return current;
  let timeout;
  const result = await Promise.race([
    observation.closePromise,
    new Promise(resolve => {
      timeout = setTimeout(() => resolve(undefined), timeoutMs);
    }),
  ]);
  clearTimeout(timeout);
  return result;
}

async function waitForOwnedTreeCompletion(observation, rootPid, pids, timeoutMs) {
  const descendantPids = pids.filter(pid => pid !== rootPid);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      observation.readClose()
      && descendantPids.every(pid => !isProcessAlive(pid))
    ) return true;
    await wait(25);
  }
  return false;
}

function signalPosixProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function terminateKnownWindowsProcesses(pids, terminateWindowsProcess) {
  // 普通 SSH 用户实测 taskkill /T /F 会返回“拒绝访问”。harness 已校验父子
  // 身份，因此按子到父的顺序终止精确 PID；生产进程树归属仍由 Job Object 负责。
  const errors = [];
  for (const pid of [...pids].reverse()) {
    if (!isProcessAlive(pid)) continue;
    try {
      terminateWindowsProcess(pid);
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        errors.push(new Error(`Windows 测试收尾无法终止 PID ${pid}`, { cause: error }));
      }
    }
  }
  return errors;
}

async function terminateSpawnedTree({
  child,
  observation,
  evidence,
  gracefulTimeoutMs,
  terminateWindowsProcess,
}) {
  const knownPids = evidence
    ? [evidence.parentPid, evidence.childPid]
    : [child.pid].filter(Number.isSafeInteger);
  let forced = false;
  const teardownErrors = [];

  if (process.platform === 'win32') {
    forced = knownPids.some(isProcessAlive);
    teardownErrors.push(...terminateKnownWindowsProcesses(knownPids, terminateWindowsProcess));
  } else if (child.pid) {
    signalPosixProcessGroup(child.pid, 'SIGTERM');
    if (!(await waitForOwnedTreeCompletion(
      observation,
      child.pid,
      knownPids,
      gracefulTimeoutMs,
    ))) {
      forced = true;
      signalPosixProcessGroup(child.pid, 'SIGKILL');
    }
  }

  // spawn error 只说明启动失败，不等于 stdio 和 ChildProcess 句柄已经关闭。
  const closeOutcome = await waitForProcessClose(observation, 5_000);
  if (!closeOutcome) {
    teardownErrors.push(new Error('父进程退出后 ChildProcess 仍未发布 close 终态'));
  }
  if (!(await waitForOwnedTreeCompletion(observation, child.pid, knownPids, 5_000))) {
    teardownErrors.push(new Error('父进程已结束，但仍有已知后代 PID 存活'));
  }
  if (teardownErrors.length > 0) {
    throw new AggregateError(teardownErrors, '父子进程收尾未完整结束');
  }
  return { forced, pids: knownPids, closeOutcome };
}

export async function startOwnedProcessTree({
  runRoot,
  terminationMode = 'cooperative',
  executable = process.execPath,
  terminateWindowsProcess = pid => process.kill(pid, 'SIGKILL'),
}) {
  const runToken = randomUUID();
  const evidencePath = path.join(runRoot, 'process-tree.json');
  const startupEvidencePath = path.join(runRoot, 'startup-process-tree.json');
  const heartbeatPrefix = path.join(runRoot, 'heartbeat');
  const parentHeartbeatPath = `${heartbeatPrefix}.parent.log`;
  const childHeartbeatPath = `${heartbeatPrefix}.child.log`;
  const child = spawn(executable, [
    fixturePath,
    evidencePath,
    startupEvidencePath,
    heartbeatPrefix,
    runToken,
    terminationMode,
  ], {
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const observation = observeChildProcess(child);
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });

  let evidence;
  try {
    evidence = await waitForProcessTreeEvidence(
      evidencePath,
      runToken,
      observation.readReadinessFailure,
    );
    await Promise.all([
      waitForHeartbeatProgress({
        heartbeatPath: parentHeartbeatPath,
        expectedRunToken: runToken,
        expectedRole: 'parent',
        expectedPid: evidence.parentPid,
      }),
      waitForHeartbeatProgress({
        heartbeatPath: childHeartbeatPath,
        expectedRunToken: runToken,
        expectedRole: 'child',
        expectedPid: evidence.childPid,
      }),
    ]);
  } catch (error) {
    const startupErrors = [error];
    let startupEvidence = evidence;
    if (!startupEvidence) {
      try {
        startupEvidence = await waitForStartupEvidence(startupEvidencePath, runToken);
      } catch (evidenceError) {
        startupErrors.push(evidenceError);
      }
    }
    if (!evidence && startupEvidence && isProcessAlive(startupEvidence.childPid)) {
      try {
        await waitForProcessesExited([startupEvidence.childPid], 750);
      } catch {
        try {
          await waitForHeartbeatProgress({
            heartbeatPath: childHeartbeatPath,
            expectedRunToken: runToken,
            expectedRole: 'child',
            expectedPid: startupEvidence.childPid,
          });
        } catch (heartbeatError) {
          startupErrors.push(heartbeatError);
          startupEvidence = undefined;
        }
      }
    }
    try {
      await terminateSpawnedTree({
        child,
        observation,
        evidence: startupEvidence,
        gracefulTimeoutMs: 250,
        terminateWindowsProcess,
      });
    } catch (teardownError) {
      startupErrors.push(teardownError);
      const startupFailure = new AggregateError(
        startupErrors,
        `父子进程 fixture 启动及收尾失败${stderr ? `：${stderr.trim()}` : ''}；请检查 ${runRoot}`,
      );
      startupFailure.preserveRunRoot = true;
      startupFailure.preserveRunRootPath = runRoot;
      throw startupFailure;
    }
    throw new AggregateError(
      startupErrors,
      `父子进程 fixture 启动失败${stderr ? `：${stderr.trim()}` : ''}`,
    );
  }

  let terminationPromise;
  return {
    runToken,
    evidence,
    evidencePath,
    startupEvidencePath,
    parentHeartbeatPath,
    childHeartbeatPath,
    terminate({ gracefulTimeoutMs = 500 } = {}) {
      // teardown 必须只有一个 owner；重复调用等待同一收尾，不能再次触碰复用 PID。
      terminationPromise ??= terminateSpawnedTree({
        child,
        observation,
        evidence,
        gracefulTimeoutMs,
        terminateWindowsProcess,
      }).then(async result => {
        await Promise.all([
          assertHeartbeatStopped({
            heartbeatPath: parentHeartbeatPath,
            expectedRunToken: runToken,
            expectedRole: 'parent',
            expectedPid: evidence.parentPid,
          }),
          assertHeartbeatStopped({
            heartbeatPath: childHeartbeatPath,
            expectedRunToken: runToken,
            expectedRole: 'child',
            expectedPid: evidence.childPid,
          }),
        ]);
        return result;
      });
      return terminationPromise;
    },
  };
}

export async function withOwnedProcessTree(options = {}, run) {
  const isolatedRoot = await createIsolatedRunRoot();
  let tree;
  let result;
  let primaryError;
  let preserveRunRoot = false;
  try {
    tree = await startOwnedProcessTree({
      runRoot: isolatedRoot.path,
      terminationMode: options?.terminationMode,
      executable: options?.executable,
      terminateWindowsProcess: options?.terminateWindowsProcess,
    });
    result = await run({ rootPath: isolatedRoot.path, tree });
  } catch (error) {
    primaryError = error;
    preserveRunRoot = error?.preserveRunRoot === true;
  }

  let teardownError;
  try {
    if (tree) await tree.terminate();
    if (!preserveRunRoot) await isolatedRoot.cleanup();
  } catch (error) {
    teardownError = error;
  }

  if (primaryError && teardownError) {
    if (primaryError === teardownError) {
      const failure = new Error(`进程收尾失败；清理未完成，请检查 ${isolatedRoot.path}`, {
        cause: teardownError,
      });
      failure.preserveRunRootPath = isolatedRoot.path;
      throw failure;
    }
    const failure = new AggregateError(
      [primaryError, teardownError],
      `测试主体和进程收尾同时失败；清理未完成，请检查 ${isolatedRoot.path}`,
    );
    failure.preserveRunRootPath = isolatedRoot.path;
    throw failure;
  }
  if (teardownError) {
    const failure = new Error(`进程收尾失败；清理未完成，请检查 ${isolatedRoot.path}`, {
      cause: teardownError,
    });
    failure.preserveRunRootPath = isolatedRoot.path;
    throw failure;
  }
  if (primaryError) throw primaryError;
  return result;
}
