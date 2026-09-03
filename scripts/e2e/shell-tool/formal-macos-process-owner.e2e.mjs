import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  assertHeartbeatStopped,
  waitFor,
  waitForHeartbeatProgress,
  waitForProcessesExited,
} from './harness/processObservation.mjs';

if (process.platform !== 'darwin') {
  throw new Error('formal macOS process owner E2E can only run on macOS');
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const execFileAsync = promisify(execFile);
const sandboxPackage = JSON.parse(await readFile(
  path.join(repositoryRoot, 'node_modules/@anthropic-ai/sandbox-runtime/package.json'),
  'utf8',
));
assert.equal(sandboxPackage.version, '0.0.67');
const hostFixturePath = path.join(
  repositoryRoot,
  'scripts/e2e/shell-tool/fixtures/process-trees/macos-owned-process-host.ts',
);

async function readJsonWhenReady(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function readProcessGroupId(pid) {
  const { stdout } = await execFileAsync('/bin/ps', ['-o', 'pgid=', '-p', String(pid)]);
  const processGroupId = Number(stdout.trim());
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 0) {
    throw new Error(`invalid process group for PID ${pid}: ${JSON.stringify(stdout)}`);
  }
  return processGroupId;
}

function isProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function runOwnerCrashScenario(iteration) {
  const isolatedRoot = await createIsolatedRunRoot();
  const runToken = randomUUID();
  let host;
  let observedProcessCount;
  let scenarioFailure;
  try {
    host = spawn(process.execPath, [
      '--import',
      'tsx',
      hostFixturePath,
      isolatedRoot.path,
      runToken,
    ], {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let diagnostics = '';
    host.stderr.on('data', chunk => {
      diagnostics = `${diagnostics}${chunk}`.slice(-32_768);
    });
    const hostExit = new Promise(resolve => {
      host.once('exit', (code, signal) => resolve({ code, signal }));
    });

    const ownerReadyPath = path.join(isolatedRoot.path, 'owner-ready.json');
    const ownerReady = await waitFor(`第 ${iteration} 轮 owner ready`, async () => {
      const payload = await readJsonWhenReady(ownerReadyPath);
      if (!payload) return undefined;
      if (
        payload.version !== 1
        || payload.runToken !== runToken
        || payload.ownerPid !== host.pid
      ) {
        throw new Error(`owner ready identity mismatch: ${JSON.stringify(payload)}`);
      }
      return payload;
    });
    assert.equal(ownerReady.ownerPid, host.pid);

    const identities = await Promise.all(['parent', 'child', 'grandchild'].map(role => (
      waitFor(`第 ${iteration} 轮 ${role} identity`, async () => {
        const payload = await readJsonWhenReady(path.join(isolatedRoot.path, `${role}.json`));
        if (!payload) return undefined;
        if (payload.runToken !== runToken || payload.role !== role) {
          throw new Error(`${role} identity mismatch: ${JSON.stringify(payload)}`);
        }
        return payload;
      })
    )));
    await Promise.all(identities.map(identity => waitForHeartbeatProgress({
      heartbeatPath: path.join(isolatedRoot.path, `${identity.role}.heartbeat.log`),
      expectedRunToken: runToken,
      expectedRole: identity.role,
      expectedPid: identity.pid,
    })));
    const processGroupIds = await Promise.all(identities.map(identity => (
      readProcessGroupId(identity.pid)
    )));
    assert.equal(new Set(processGroupIds).size, 1, '父、子、孙必须属于同一个冻结进程组');
    const [processGroupId] = processGroupIds;
    assert.ok(processGroupId > 0);

    process.kill(host.pid, 'SIGKILL');
    const exit = await hostExit;
    assert.equal(exit.code, null, diagnostics);
    assert.equal(exit.signal, 'SIGKILL', diagnostics);

    const processIds = identities.map(identity => identity.pid);
    await waitForProcessesExited(processIds);
    await waitFor(`第 ${iteration} 轮完整进程组归零`, () => (
      !isProcessGroupAlive(processGroupId)
    ));
    await Promise.all(identities.map(identity => assertHeartbeatStopped({
      heartbeatPath: path.join(isolatedRoot.path, `${identity.role}.heartbeat.log`),
      expectedRunToken: runToken,
      expectedRole: identity.role,
      expectedPid: identity.pid,
    })));
    observedProcessCount = processIds.length;
  } catch (error) {
    scenarioFailure = error;
  }

  const cleanupFailures = [];
  if (host?.pid && host.exitCode === null && host.signalCode === null) {
    try {
      process.kill(host.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') cleanupFailures.push(error);
    }
  }
  try {
    await isolatedRoot.cleanup();
  } catch (error) {
    cleanupFailures.push(error);
  }
  if (scenarioFailure || cleanupFailures.length > 0) {
    throw new AggregateError(
      [scenarioFailure, ...cleanupFailures].filter(error => error !== undefined),
      `第 ${iteration} 轮 macOS owner 强杀场景或清理失败`,
    );
  }
  if (observedProcessCount === undefined) {
    throw new Error(`第 ${iteration} 轮 macOS owner 强杀场景没有形成观察结果`);
  }
  return observedProcessCount;
}

let observedProcesses = 0;
for (let iteration = 1; iteration <= 20; iteration += 1) {
  observedProcesses += await runOwnerCrashScenario(iteration);
}

console.log(JSON.stringify({
  success: true,
  version: 1,
  platform: process.platform,
  architecture: process.arch,
  sandboxRuntimeVersion: sandboxPackage.version,
  ownerCrashIterations: 20,
  observedBusinessProcesses: observedProcesses,
  observedProcessGroups: 20,
}));
