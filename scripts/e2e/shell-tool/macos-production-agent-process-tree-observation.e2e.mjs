import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import { waitFor } from './harness/processObservation.mjs';
import {
  assertMacosProductionAgentProcessTreeExited,
  createProductionAgentProcessTreeCommand,
  isMacosProcessGroupAlive,
  observeMacosProductionAgentProcessTree,
} from './harness/productionAgentProcessTree.mjs';

if (process.platform !== 'darwin') {
  throw new Error('macOS production Agent process-tree observation E2E only runs on macOS');
}

const isolated = await createIsolatedRunRoot('production-agent-process-tree-observation');
const runToken = randomUUID();
const evidenceDirectoryName = `process-tree-${runToken}`;
const evidenceRoot = path.join(isolated.path, evidenceDirectoryName);
let child;
let closed;
let observation;
let closeOutcome;
let scenarioError;
try {
  child = spawn('/bin/zsh', ['-c', createProductionAgentProcessTreeCommand({
    evidenceDirectoryName,
    runToken,
  })], {
    cwd: isolated.path,
    detached: true,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      closeOutcome = { kind: 'close', code, signal };
      resolve(closeOutcome);
    });
  });
  let stderr = '';
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-16_384); });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-16_384); });

  observation = await observeMacosProductionAgentProcessTree({
    runRoot: evidenceRoot,
    runToken,
    readProcessOutcome: () => closeOutcome,
  });
  assert.equal(observation.instances[0].pid, child.pid, 'exec 后 parent 应保留命令根 PID');
  assert.equal(isMacosProcessGroupAlive(observation.processGroupId), true);
  assert.match(stdout, /production-agent-parent-start/u);
  await waitFor('parent 持续 stdout 标记', () => (
    /production-agent-parent-tick-\d+/u.test(stdout)
  ));

  process.kill(-observation.processGroupId, 'SIGTERM');
  const exited = await assertMacosProductionAgentProcessTreeExited(observation);
  const rootClose = await closed;
  assert.equal(rootClose.code, 0, stderr);
  assert.equal(rootClose.signal, null, stderr);
  assert.deepEqual(exited, {
    processGroupId: observation.processGroupId,
    exitedProcessCount: 3,
  });

  process.stdout.write(`${JSON.stringify({
    success: true,
    version: 1,
    platform: process.platform,
    architecture: process.arch,
    processGroupId: observation.processGroupId,
    observedRoles: observation.instances.map(instance => instance.role),
    pidReuseGuard: 'pid+lstart+argv-token-role',
  })}\n`);
} catch (error) {
  scenarioError = error;
}

let cleanupError;
try {
  if (observation && isMacosProcessGroupAlive(observation.processGroupId)) {
    process.kill(-observation.processGroupId, 'SIGKILL');
  } else if (child?.pid && !observation) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  if (closed && closeOutcome === undefined) {
    await closed;
  }
  await isolated.cleanup();
} catch (error) {
  cleanupError = error;
}

if (scenarioError && cleanupError) {
  throw new AggregateError([scenarioError, cleanupError], '进程树验证与收尾同时失败');
}
if (scenarioError) throw scenarioError;
if (cleanupError) throw cleanupError;
