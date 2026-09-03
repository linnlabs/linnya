import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import {
  readMacosDescendantInstances,
  readMacosLaunchServicesApplicationRecords,
} from './harness/macosElectronProcessObservation.mjs';
import { waitFor } from './harness/processObservation.mjs';

if (process.platform !== 'darwin') {
  throw new Error('sandbox utility development E2E currently requires macOS');
}

const repositoryRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const electronBinary = path.join(
  repositoryRoot,
  'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
);
const fixtureMain = path.join(
  repositoryRoot,
  'scripts/e2e/shell-tool/fixtures/sandbox-utility-process/main.cjs',
);
const utilityPath = path.join(repositoryRoot, 'dist/main/sandbox/sandboxUtilityProcess.cjs');
const evaluatorPath = path.join(repositoryRoot, 'dist/main/sandbox/sandboxEvaluatorProcess.cjs');
const nodeExecutable = path.join(
  repositoryRoot,
  'extraResources/headless-node-runtime/darwin/arm64/bin/node',
);
const completedRunDirectories = [];

async function runScenario(scenario) {
  const runDirectory = await mkdtemp(path.join(os.tmpdir(), 'linnya-sandbox-utility-'));
  completedRunDirectories.push(runDirectory);
  const runToken = randomBytes(16).toString('hex');
  await writeFile(path.join(runDirectory, 'request.json'), JSON.stringify({
    protocol_version: 1,
    kind: 'sandbox_request',
    run_token: runToken,
    request: {
      runId: 'sandbox-utility-e2e',
      profileId: 'default',
      language: 'javascript',
      source: scenario === 'identity_observation'
        ? 'while (true) {}'
        : 'console.log("utility 中文"); return { ok: true };',
      globals: {},
      bindings: [],
      limits: {
        timeoutMs: scenario === 'identity_observation' ? 2_000 : 10_000,
        maxLogLines: 20,
        maxLogLineLength: 2_000,
        maxResultBytes: 256 * 1024,
        maxSourceBytes: 128 * 1024,
        maxCapabilityPayloadBytes: 256 * 1024,
        maxHeapMb: 64,
        idleTimeoutMs: 12_000,
      },
      capabilities: [],
    },
  }), { mode: 0o600 });

  const child = spawn(electronBinary, [fixtureMain], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      LINNYA_SANDBOX_E2E_GENERATION: randomUUID(),
      LINNYA_SANDBOX_E2E_RUN_TOKEN: runToken,
      LINNYA_SANDBOX_E2E_RUN_DIRECTORY: runDirectory,
      LINNYA_SANDBOX_E2E_UTILITY_PATH: utilityPath,
      LINNYA_SANDBOX_E2E_EVALUATOR_PATH: evaluatorPath,
      LINNYA_SANDBOX_E2E_NODE_EXECUTABLE: nodeExecutable,
      LINNYA_SANDBOX_E2E_SCENARIO: scenario,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)));
  const exitPromise = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const identity = scenario === 'identity_observation'
    ? await Promise.race([
        observeDevelopmentProcessIdentity(child.pid, runDirectory),
        exitPromise.then(() => {
          throw new Error('development Electron exited before identity observation');
        }),
      ])
    : undefined;
  const exit = await exitPromise;
  assert.deepEqual(exit, { code: 0, signal: null }, Buffer.concat(stderr).toString('utf8'));

  return {
    runDirectory,
    runToken,
    identity,
    observation: JSON.parse(Buffer.concat(stdout).toString('utf8').trim()),
  };
}

async function observeDevelopmentProcessIdentity(mainPid, runDirectory) {
  const identity = await waitFor('development Sandbox evaluator identity', async () => {
    try {
      return JSON.parse(await readFile(path.join(runDirectory, 'identity.json'), 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }, 10_000);
  assert.equal(identity.mainPid, mainPid);
  const descendants = await readMacosDescendantInstances(mainPid);
  const utility = descendants.find(instance => instance.pid === identity.utilityPid);
  const evaluator = descendants.find(instance => instance.pid === identity.evaluatorPid);
  assert(utility, 'development Sandbox Utility must be a Main descendant');
  assert(evaluator, 'development Sandbox evaluator must be a Main descendant');
  assert.equal(evaluator.parentPid, utility.pid);
  assert(evaluator.command.includes('sandboxEvaluatorProcess.cjs'));
  assert(evaluator.command.includes('/extraResources/headless-node-runtime/darwin/arm64/bin/node'));
  const launchServices = await readMacosLaunchServicesApplicationRecords();
  assert.equal(launchServices.get(mainPid)?.type, 'Foreground');
  assert.equal(
    launchServices.has(evaluator.pid),
    false,
    'development headless Node evaluator must not register an App identity',
  );
  for (const descendant of descendants) {
    assert.notEqual(
      launchServices.get(descendant.pid)?.type,
      'Foreground',
      `development Sandbox descendant ${descendant.pid} must not become a foreground App`,
    );
  }
  return {
    mainForeground: true,
    evaluatorLaunchServicesRegistered: false,
    foregroundSandboxDescendants: 0,
    evaluatorPid: evaluator.pid,
  };
}

try {
  const normal = await runScenario('normal');
  const { observation, runDirectory, runToken } = normal;
  assert.equal(observation.exitCode, 0);
  assert.deepEqual(observation.hostAcknowledgements, [0]);
  assert.deepEqual(observation.frames.map(frame => frame.frame), [
    'ready',
    'started',
    'result_committed',
  ]);
  assert(observation.frames.every(frame => frame.runToken === runToken));
  assert.equal(observation.terminal.cause, 'natural');
  assert.deepEqual(observation.terminal.rootExit, { exitCode: 0, signal: null });
  assert.deepEqual(observation.terminal.settlementFailures, []);
  assert.equal(observation.terminal.control.completed, true);
  assert.equal(observation.utilityStderr, '');
  assert.equal(observation.result.run_token, runToken);
  assert.equal(observation.result.result.success, true);
  assert.deepEqual(observation.result.result.value, { ok: true });
  assert.deepEqual(observation.result.result.logs, ['utility 中文']);
  assert.equal('stderr' in observation.result.result, false);
  assert.equal('diagnostics' in observation.result.result, false);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(runDirectory, 'result.json'), 'utf8')),
    observation.result,
  );

  const cancelled = await runScenario('cancel_before_start');
  assert.equal(cancelled.observation.exitCode, 0);
  assert.deepEqual(cancelled.observation.hostAcknowledgements, [0, 1]);
  assert.deepEqual(cancelled.observation.frames, []);
  assert.equal(cancelled.observation.terminal.cause, 'cancelled');
  assert.equal(cancelled.observation.terminal.rootExit, undefined);
  assert.equal(cancelled.observation.result, null);

  const ownerEnded = await runScenario('owner_end_before_start');
  assert.equal(ownerEnded.observation.exitCode, 0);
  assert.deepEqual(ownerEnded.observation.frames, []);
  assert.equal(ownerEnded.observation.terminal, undefined);
  assert.equal(ownerEnded.observation.result, null);

  const acknowledgementTimedOut = await runScenario('ready_ack_timeout');
  assert.equal(acknowledgementTimedOut.observation.exitCode, 1);
  assert.deepEqual(acknowledgementTimedOut.observation.hostAcknowledgements, []);
  assert.deepEqual(acknowledgementTimedOut.observation.frames, []);
  assert.equal(acknowledgementTimedOut.observation.terminal, undefined);
  assert.equal(acknowledgementTimedOut.observation.result, null);

  const identityObserved = await runScenario('identity_observation');
  assert.deepEqual(identityObserved.identity, {
    mainForeground: true,
    evaluatorLaunchServicesRegistered: false,
    foregroundSandboxDescendants: 0,
    evaluatorPid: identityObserved.observation.frames[0].evaluatorPid,
  });
  assert.equal(identityObserved.observation.terminal.cause, 'natural');
  assert.equal(identityObserved.observation.result.result.success, false);
  assert.equal(identityObserved.observation.result.result.error.type, 'timeout');

  process.stdout.write(`${JSON.stringify({
    success: true,
    platform: process.platform,
    architecture: process.arch,
    utilityExitCode: observation.exitCode,
    evaluatorPid: observation.frames[0].evaluatorPid,
    controlFrames: observation.frames.map(frame => frame.frame),
    resultKind: 'evaluation_only',
    childScenarios: [
      'normal',
      'cancel_before_start',
      'owner_end_before_start',
      'ready_ack_timeout',
      'identity_observation',
    ],
    developmentLaunchServicesIdentityVerified: true,
  }, null, 2)}\n`);
} finally {
  await Promise.all(completedRunDirectories.map(runDirectory => (
    rm(runDirectory, { recursive: true, force: true })
  )));
}
