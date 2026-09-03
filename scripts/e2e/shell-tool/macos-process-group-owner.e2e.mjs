import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import console from 'node:console';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  assertHeartbeatStopped,
  isProcessAlive,
  wait,
  waitFor,
  waitForHeartbeatProgress,
  waitForProcessesExited,
} from './harness/processObservation.mjs';

const execFileAsync = promisify(execFile);
const fixturePath = fileURLToPath(
  new URL('./fixtures/process-trees/macos-process-group-tree.cjs', import.meta.url),
);
const srtModulePath = process.env.LINNYA_SRT_MODULE_PATH;

if (process.platform !== 'darwin') {
  throw new Error('macOS process-group owner E2E can only run on macOS');
}
if (!srtModulePath || !path.isAbsolute(srtModulePath)) {
  throw new Error('LINNYA_SRT_MODULE_PATH must point to SRT 0.0.67 dist/index.js');
}

const srtPackageRoot = path.dirname(path.dirname(srtModulePath));
const srtPackage = JSON.parse(await readFile(path.join(srtPackageRoot, 'package.json'), 'utf8'));
assert.equal(srtPackage.version, '0.0.67');
const { SandboxManager } = await import(pathToFileURL(srtModulePath).href);
await SandboxManager.initialize({
  network: {
    allowedDomains: [],
    deniedDomains: [],
  },
  filesystem: {
    allowWrite: [],
    denyWrite: [],
    denyRead: [],
  },
});
const hostProcessFact = await readProcessFact(process.pid);
assert(hostProcessFact, '无法读取测试宿主进程事实');

function quoteShell(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function observeRootProcess(child) {
  const stdout = [];
  const stderr = [];
  const state = {
    exit: undefined,
    stdoutEnded: false,
    stderrEnded: false,
    close: undefined,
  };
  child.stdout.on('data', chunk => stdout.push(chunk));
  child.stderr.on('data', chunk => stderr.push(chunk));
  child.stdout.once('end', () => { state.stdoutEnded = true; });
  child.stderr.once('end', () => { state.stderrEnded = true; });
  child.once('exit', (code, signal) => { state.exit = { code, signal }; });
  child.once('close', (code, signal) => { state.close = { code, signal }; });
  return {
    state,
    stdout: () => Buffer.concat(stdout).toString('utf8'),
    stderr: () => Buffer.concat(stderr).toString('utf8'),
  };
}

async function readProcessFact(pid) {
  try {
    const { stdout } = await execFileAsync('/bin/ps', [
      '-o',
      'pid=,ppid=,pgid=,stat=',
      '-p',
      String(pid),
    ]);
    const fields = stdout.trim().split(/\s+/u);
    if (fields.length < 4) return undefined;
    return {
      pid: Number(fields[0]),
      parentPid: Number(fields[1]),
      processGroupId: Number(fields[2]),
      state: fields[3],
    };
  } catch (error) {
    if (error?.code === 1) return undefined;
    throw error;
  }
}

async function readIdentity(runRoot, runToken, role) {
  try {
    const payload = JSON.parse(await readFile(path.join(runRoot, `${role}.json`), 'utf8'));
    if (
      payload?.version !== 1
      || payload.runToken !== runToken
      || payload.role !== role
      || !Number.isSafeInteger(payload.pid)
      || payload.pid <= 0
    ) {
      throw new Error(`${role} identity 无效`);
    }
    return payload;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isProcessGroupAlive(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    // macOS 可对仍存在的沙箱进程组拒绝零号信号，这不能被当成树已经清空。
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function waitForBoolean(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await wait(20);
  }
  return Boolean(await check());
}

async function waitForRootObservation(scenario) {
  await waitFor('root exit、双流 EOF 与 close', () => (
    scenario.observation.state.exit
    && scenario.observation.state.stdoutEnded
    && scenario.observation.state.stderrEnded
    && scenario.observation.state.close
  ));
}

async function currentKnownFacts(scenario) {
  const entries = await Promise.all([
    readProcessFact(scenario.rootPid),
    ...scenario.identities.map(identity => readProcessFact(identity.pid)),
  ]);
  return entries.filter(Boolean);
}

async function signalFrozenOwnedGroup(scenario, processGroupId, signal) {
  const facts = await currentKnownFacts(scenario);
  const ownedMember = facts.find(fact => fact.processGroupId === processGroupId);
  if (!ownedMember) return false;
  assert.notEqual(processGroupId, hostProcessFact.processGroupId, '拒绝向测试宿主进程组发送信号');
  process.kill(-processGroupId, signal);
  return true;
}

async function terminateFrozenGroup(scenario, processGroupId, gracefulTimeoutMs = 400) {
  if (!isProcessGroupAlive(processGroupId)) return { delivered: false, forced: false };
  const delivered = await signalFrozenOwnedGroup(scenario, processGroupId, 'SIGTERM');
  assert(delivered, `进程组 ${processGroupId} 存在，但没有已验证的本轮成员`);
  let groupGone = await waitForBoolean(() => !isProcessGroupAlive(processGroupId), gracefulTimeoutMs);
  let forced = false;
  if (!groupGone) {
    forced = true;
    const killDelivered = await signalFrozenOwnedGroup(scenario, processGroupId, 'SIGKILL');
    assert(killDelivered, `无法安全升级终止进程组 ${processGroupId}`);
    groupGone = await waitForBoolean(() => !isProcessGroupAlive(processGroupId), 5_000);
  }
  assert(groupGone, `进程组 ${processGroupId} 未归零`);
  return { delivered, forced };
}

async function assertKnownProcessesExited(scenario) {
  const pids = [scenario.rootPid, ...scenario.identities.map(identity => identity.pid)];
  await waitForProcessesExited(pids);
  assert(pids.every(pid => !isProcessAlive(pid)));
}

async function assertHeartbeatsStopped(scenario) {
  await Promise.all(scenario.identities.map(identity => assertHeartbeatStopped({
    heartbeatPath: path.join(scenario.runRoot, `${identity.role}.heartbeat.log`),
    expectedRunToken: scenario.runToken,
    expectedRole: identity.role,
    expectedPid: identity.pid,
  })));
}

async function verifySameFrozenGroup(scenario) {
  const rootFact = await readProcessFact(scenario.rootPid);
  assert(rootFact, 'SRT wrapper 在 PGID 验真前退出');
  assert.equal(rootFact.processGroupId, scenario.processGroupId);
  for (const identity of scenario.identities) {
    const fact = await readProcessFact(identity.pid);
    assert(fact, `${identity.role} 在 PGID 验真前退出`);
    assert.equal(fact.processGroupId, scenario.processGroupId, `${identity.role} 逃离冻结 PGID`);
  }
}

async function startScenario(mode) {
  const isolatedRoot = await createIsolatedRunRoot();
  const runToken = randomUUID();
  let startedScenario;
  try {
    const filesystem = {
      filesystem: {
        allowWrite: [isolatedRoot.path],
        denyWrite: [],
        denyRead: [],
        allowRead: [],
      },
    };
    const command = [
      'exec',
      quoteShell(process.execPath),
      quoteShell(fixturePath),
      quoteShell(isolatedRoot.path),
      quoteShell(runToken),
      quoteShell(mode),
    ].join(' ');
    const descriptor = await SandboxManager.wrapWithSandboxArgv(
      command,
      '/bin/zsh',
      filesystem,
      undefined,
      isolatedRoot.path,
    );
    assert.deepEqual(descriptor.argv.slice(0, 2), ['/bin/zsh', '-c']);
    assert.equal(descriptor.argv.length, 3);
    assert.match(descriptor.argv[2], /\/usr\/bin\/sandbox-exec -p /u);
    const child = spawn(descriptor.argv[0], descriptor.argv.slice(1), {
      cwd: isolatedRoot.path,
      env: descriptor.env,
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert(Number.isSafeInteger(child.pid) && child.pid > 0);
    const observation = observeRootProcess(child);
    startedScenario = {
      mode,
      runRoot: isolatedRoot.path,
      cleanupRoot: isolatedRoot.cleanup,
      runToken,
      rootPid: child.pid,
      processGroupId: child.pid,
      identities: [],
      observation,
    };

    // detached 只在 spawn 时建立进程组；立即验真并冻结 PGID，不允许以后用旧 PID 重查。
    const rootFact = await waitFor('独立进程组身份', () => readProcessFact(child.pid));
    assert.equal(rootFact.processGroupId, child.pid);

    const roles = ['parent', 'child', 'grandchild'];
    startedScenario.identities = await Promise.all(roles.map(role => waitFor(
      `${role} identity`,
      () => readIdentity(isolatedRoot.path, runToken, role),
    )));
    await Promise.all(startedScenario.identities.map(identity => waitForHeartbeatProgress({
      heartbeatPath: path.join(isolatedRoot.path, `${identity.role}.heartbeat.log`),
      expectedRunToken: runToken,
      expectedRole: identity.role,
      expectedPid: identity.pid,
    })));
    return startedScenario;
  } catch (error) {
    try {
      if (startedScenario) {
        await cleanupScenario(startedScenario);
      } else {
        await isolatedRoot.cleanup();
      }
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `${mode} 启动与回滚同时失败`);
    }
    throw error;
  }
}

async function cleanupScenario(scenario) {
  const facts = await currentKnownFacts(scenario);
  const groups = [...new Set(facts.map(fact => fact.processGroupId))];
  for (const processGroupId of groups) {
    await terminateFrozenGroup(scenario, processGroupId, 100);
  }
  await assertKnownProcessesExited(scenario);
  await scenario.cleanupRoot();
}

async function withScenario(mode, run) {
  const scenario = await startScenario(mode);
  let result;
  let primaryError;
  try {
    result = await run(scenario);
  } catch (error) {
    primaryError = error;
  }
  let cleanupError;
  try {
    await cleanupScenario(scenario);
  } catch (error) {
    cleanupError = error;
  }
  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], `${mode} 主体与收尾同时失败`);
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return result;
}

const results = [];

await withScenario('natural', async (scenario) => {
  await verifySameFrozenGroup(scenario);
  await waitForRootObservation(scenario);
  assert.deepEqual(scenario.observation.state.exit, { code: 7, signal: null });
  assert.match(scenario.observation.stdout(), /parent:stdout/u);
  assert.match(scenario.observation.stdout(), /grandchild:stdout/u);
  assert.match(scenario.observation.stderr(), /parent:stderr/u);
  assert.match(scenario.observation.stderr(), /grandchild:stderr/u);
  assert.equal(await waitForBoolean(() => !isProcessGroupAlive(scenario.processGroupId), 5_000), true);
  assert.equal(isProcessGroupAlive(scenario.processGroupId), false);
  await assertHeartbeatsStopped(scenario);
  results.push({ scenario: 'natural', exitCode: 7, groupAbsentWithoutSignal: true });
});

await withScenario('cooperative', async (scenario) => {
  await verifySameFrozenGroup(scenario);
  const stopped = await terminateFrozenGroup(scenario, scenario.processGroupId);
  assert.deepEqual(stopped, { delivered: true, forced: false });
  await waitForRootObservation(scenario);
  await assertKnownProcessesExited(scenario);
  await assertHeartbeatsStopped(scenario);
  results.push({ scenario: 'cooperative', ...stopped });
});

await withScenario('ignore-term', async (scenario) => {
  await verifySameFrozenGroup(scenario);
  const stopped = await terminateFrozenGroup(scenario, scenario.processGroupId, 120);
  assert.deepEqual(stopped, { delivered: true, forced: true });
  await waitForRootObservation(scenario);
  await assertKnownProcessesExited(scenario);
  await assertHeartbeatsStopped(scenario);
  results.push({ scenario: 'ignore-term', ...stopped });
});

await withScenario('root-exit', async (scenario) => {
  await verifySameFrozenGroup(scenario);
  await waitForRootObservation(scenario);
  assert.deepEqual(scenario.observation.state.exit, { code: 23, signal: null });
  assert.equal(isProcessAlive(scenario.rootPid), false);
  assert.equal(isProcessGroupAlive(scenario.processGroupId), true);
  const surviving = scenario.identities.filter(identity => identity.role !== 'parent');
  assert(surviving.every(identity => isProcessAlive(identity.pid)));
  const stopped = await terminateFrozenGroup(scenario, scenario.processGroupId);
  assert.deepEqual(stopped, { delivered: true, forced: false });
  await assertKnownProcessesExited(scenario);
  await assertHeartbeatsStopped(scenario);
  results.push({ scenario: 'root-exit', rootCloseBeforeTreeEmpty: true, ...stopped });
});

await withScenario('escape-session', async (scenario) => {
  const parentIdentity = scenario.identities.find(identity => identity.role === 'parent');
  const childIdentity = scenario.identities.find(identity => identity.role === 'child');
  const grandchildIdentity = scenario.identities.find(identity => identity.role === 'grandchild');
  const parentFact = await readProcessFact(parentIdentity.pid);
  const childFact = await readProcessFact(childIdentity.pid);
  const grandchildFact = await readProcessFact(grandchildIdentity.pid);
  assert(parentFact && childFact && grandchildFact);
  assert.equal(parentFact.processGroupId, scenario.processGroupId);
  assert.equal(childFact.processGroupId, childIdentity.pid);
  assert.equal(grandchildFact.processGroupId, childIdentity.pid);

  const originalStopped = await terminateFrozenGroup(scenario, scenario.processGroupId);
  assert.deepEqual(originalStopped, { delivered: true, forced: false });
  await waitForRootObservation(scenario);
  assert.equal(isProcessAlive(childIdentity.pid), true);
  assert.equal(isProcessAlive(grandchildIdentity.pid), true);

  const escapedStopped = await terminateFrozenGroup(scenario, childIdentity.pid);
  assert.deepEqual(escapedStopped, { delivered: true, forced: false });
  await assertKnownProcessesExited(scenario);
  await assertHeartbeatsStopped(scenario);
  results.push({
    scenario: 'escape-session',
    originalGroupDidNotContainNewSession: true,
    escapedProcessGroupId: childIdentity.pid,
  });
});

await SandboxManager.reset();

console.log(JSON.stringify({
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  srt: srtPackage.version,
  results,
}, null, 2));
