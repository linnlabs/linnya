import assert from 'node:assert/strict';
import console from 'node:console';
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  isProcessAlive,
  waitForProcessesExited,
} from './harness/processObservation.mjs';
import {
  startOwnedProcessTree,
  withOwnedProcessTree,
} from './harness/ownedProcessTree.mjs';

async function expectPathMissing(targetPath) {
  await assert.rejects(access(targetPath), error => error?.code === 'ENOENT');
}

async function verifyIsolatedRoots() {
  const first = await createIsolatedRunRoot();
  const second = await createIsolatedRunRoot();
  try {
    assert.notEqual(first.path, second.path);
  } finally {
    await Promise.all([first.cleanup(), second.cleanup()]);
  }
  await Promise.all([expectPathMissing(first.path), expectPathMissing(second.path)]);
}

async function verifyNormalTeardown() {
  let observedRoot;
  let observedPids;
  await withOwnedProcessTree({}, async ({ rootPath, tree }) => {
    observedRoot = rootPath;
    observedPids = [tree.evidence.parentPid, tree.evidence.childPid];
    assert.equal(tree.evidence.runToken, tree.runToken);
    assert(observedPids.every(isProcessAlive));

    const firstTeardown = tree.terminate();
    const secondTeardown = tree.terminate();
    assert.equal(firstTeardown, secondTeardown);
    const result = await firstTeardown;
    assert.equal(result.forced, process.platform === 'win32');
    assert.deepEqual(result.pids, observedPids);
  });
  await waitForProcessesExited([observedPids[1]]);
  await expectPathMissing(observedRoot);
}

async function verifyForcedEscalation() {
  if (process.platform === 'win32') return;
  await withOwnedProcessTree({ terminationMode: 'child-ignore-term' }, async ({ tree }) => {
    const result = await tree.terminate({ gracefulTimeoutMs: 100 });
    assert.equal(result.forced, true);
  });
}

async function verifyStartupFailureCleansKnownChild() {
  const isolatedRoot = await createIsolatedRunRoot();
  const evidencePath = path.join(isolatedRoot.path, 'process-tree.json');
  let processTreeExited = false;
  try {
    await assert.rejects(
      startOwnedProcessTree({
        runRoot: isolatedRoot.path,
        terminationMode: 'fail-after-child-start',
      }),
      /父子进程 fixture 启动失败/,
    );
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    const pids = [evidence.parentPid, evidence.childPid];
    assert(pids.every(pid => Number.isSafeInteger(pid) && pid > 0));
    assert.notEqual(pids[0], pids[1]);
    await waitForProcessesExited([evidence.childPid]);
    processTreeExited = true;
  } finally {
    // 失败时保留目录和 PID 证据；只有外层确认整树归零后才能删测试目录。
    if (processTreeExited) await isolatedRoot.cleanup();
  }
}

async function verifyParentExitBeforeReadyStillFindsChild() {
  const isolatedRoot = await createIsolatedRunRoot();
  const startupEvidencePath = path.join(isolatedRoot.path, 'startup-process-tree.json');
  let processTreeExited = false;
  try {
    await assert.rejects(
      startOwnedProcessTree({
        runRoot: isolatedRoot.path,
        terminationMode: 'parent-exit-before-ready',
      }),
      /父子进程 fixture 启动失败/,
    );
    const evidence = JSON.parse(await readFile(startupEvidencePath, 'utf8'));
    const pids = [evidence.parentPid, evidence.childPid];
    assert(pids.every(pid => Number.isSafeInteger(pid) && pid > 0));
    await waitForProcessesExited([evidence.childPid]);
    processTreeExited = true;
  } finally {
    if (processTreeExited) await isolatedRoot.cleanup();
  }
}

async function verifyEvidenceChannelReservedBeforeChild() {
  const isolatedRoot = await createIsolatedRunRoot();
  const startupEvidencePath = path.join(isolatedRoot.path, 'startup-process-tree.json');
  const childHeartbeatPath = path.join(isolatedRoot.path, 'heartbeat.child.log');
  try {
    await mkdir(startupEvidencePath);
    await assert.rejects(
      startOwnedProcessTree({ runRoot: isolatedRoot.path }),
      /父子进程 fixture 启动失败/,
    );
    await expectPathMissing(childHeartbeatPath);
  } finally {
    await isolatedRoot.cleanup();
  }
}

async function verifySpawnErrorWaitsForClose() {
  const isolatedRoot = await createIsolatedRunRoot();
  try {
    await assert.rejects(
      startOwnedProcessTree({
        runRoot: isolatedRoot.path,
        executable: path.join(isolatedRoot.path, 'missing-node-executable'),
      }),
      /父子进程 fixture 启动失败/,
    );
  } finally {
    await isolatedRoot.cleanup();
  }
}

async function verifyWindowsAttemptsEveryKnownPid() {
  if (process.platform !== 'win32') return;
  const isolatedRoot = await createIsolatedRunRoot();
  const attemptedPids = [];
  let tree;
  try {
    tree = await startOwnedProcessTree({
      runRoot: isolatedRoot.path,
      terminateWindowsProcess(pid) {
        attemptedPids.push(pid);
        process.kill(pid, 'SIGKILL');
        const error = new Error('intentional Windows kill failure');
        error.code = 'EACCES';
        throw error;
      },
    });
    const pids = [tree.evidence.parentPid, tree.evidence.childPid];
    await assert.rejects(tree.terminate(), /父子进程收尾未完整结束/);
    assert.deepEqual(attemptedPids, [...pids].reverse());
    await waitForProcessesExited([tree.evidence.childPid]);
  } finally {
    await isolatedRoot.cleanup();
  }
}

async function verifyWindowsWrapperPreservesFailedTeardownEvidence() {
  if (process.platform !== 'win32') return;
  let observedRoot;
  let childPid;
  let preservedRoot;
  await assert.rejects(
    withOwnedProcessTree({
      terminateWindowsProcess(pid) {
        process.kill(pid, 'SIGKILL');
        const error = new Error('intentional wrapper teardown failure');
        error.code = 'EACCES';
        throw error;
      },
    }, async ({ rootPath, tree }) => {
      observedRoot = rootPath;
      childPid = tree.evidence.childPid;
    }),
    error => {
      preservedRoot = error?.preserveRunRootPath;
      return preservedRoot === observedRoot;
    },
  );
  await access(preservedRoot);
  await waitForProcessesExited([childPid]);
  await rm(preservedRoot, { recursive: true, force: true });
}

async function verifyFailureStillCleansUp() {
  const expected = new Error('intentional harness failure');
  let observedRoot;
  let observedPids;
  await assert.rejects(
    withOwnedProcessTree({}, async ({ rootPath, tree }) => {
      observedRoot = rootPath;
      observedPids = [tree.evidence.parentPid, tree.evidence.childPid];
      throw expected;
    }),
    error => error === expected,
  );
  await waitForProcessesExited([observedPids[1]]);
  await expectPathMissing(observedRoot);
}

await verifyIsolatedRoots();
await verifyNormalTeardown();
await verifyForcedEscalation();
await verifyStartupFailureCleansKnownChild();
await verifyParentExitBeforeReadyStillFindsChild();
await verifyEvidenceChannelReservedBeforeChild();
await verifySpawnErrorWaitsForClose();
await verifyWindowsAttemptsEveryKnownPid();
await verifyWindowsWrapperPreservesFailedTeardownEvidence();
await verifyFailureStillCleansUp();

const platformTeardown = process.platform === 'win32'
  ? '已校验 PID 逆序收尾（仅测试）'
  : 'SIGTERM 后按整树状态升级 SIGKILL';
console.log(`[shell-tool-harness] ${process.platform} 外部验真、${platformTeardown}与失败收尾合同通过。`);
