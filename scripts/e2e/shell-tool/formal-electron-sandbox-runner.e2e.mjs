import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

import { createIsolatedRunRoot } from './harness/isolatedRunRoot.mjs';
import {
  bindElectronVersion,
  expectedElectronVersion,
} from './harness/electronRuntimeIdentity.mjs';
import {
  isSameMacosProcessInstanceAlive,
  readMacosDescendantInstances,
  readMacosLaunchServicesApplicationRecords,
} from './harness/macosElectronProcessObservation.mjs';
import { waitFor } from './harness/processObservation.mjs';
import {
  isMacosProcessGroupAlive,
  readMacosProcessInstance,
} from './harness/productionAgentProcessTree.mjs';

const fixtureDirectory = fileURLToPath(new URL(
  './fixtures/formal-sandbox-runner/',
  import.meta.url,
));
const repositoryRoot = path.resolve(fixtureDirectory, '../../../../..');
const productionUtilityPath = path.join(
  repositoryRoot,
  'dist/main/sandbox/sandboxUtilityProcess.cjs',
);
const productionEvaluatorPath = path.join(
  repositoryRoot,
  'dist/main/sandbox/sandboxEvaluatorProcess.cjs',
);
const preparedSandboxNodeRuntime = path.join(
  repositoryRoot,
  'extraResources/headless-node-runtime/darwin/arm64',
);
const fuseCliPath = path.join(repositoryRoot, 'node_modules/@electron/fuses/dist/bin.js');
const asarCliPath = path.join(
  repositoryRoot,
  'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/bin/asar.js',
);
const OUTPUT_LIMIT = 256 * 1024;
const SOURCE_SENTINEL = 'LINNYA_PRIVATE_SOURCE_SENTINEL_9f7c6a';
const requestedScenario = process.argv.find(argument => argument.startsWith('--scenario='))
  ?.slice('--scenario='.length) ?? 'all';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('formal Electron Sandbox runner E2E requires macOS arm64');
}
if (!['all', 'suite', 'crash'].includes(requestedScenario)) {
  throw new Error(`unsupported formal Sandbox scenario: ${requestedScenario}`);
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-OUTPUT_LIMIT);
}

function runProcess(file, args, {
  cwd = repositoryRoot,
  env = process.env,
  timeoutMs = 60_000,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') reject(error);
      }
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${file} exceeded ${timeoutMs}ms; stderr=${stderr}`));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runChecked(file, args, options) {
  const result = await runProcess(file, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${file} failed: code=${result.code} signal=${result.signal ?? 'none'} `
        + `stderr=${result.stderr} stdout=${result.stdout}`,
    );
  }
  return result;
}

function observeChild(child) {
  let stdout = '';
  let stderr = '';
  let outcome;
  const closed = new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => { stdout = appendBounded(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = appendBounded(stderr, chunk); });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      outcome = { code, signal };
      resolve(outcome);
    });
  });
  return {
    closed,
    readOutcome: () => outcome,
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function waitForResult(filePath, observation, expectedPhase, timeoutMs = 45_000) {
  return waitFor(`formal Sandbox ${expectedPhase}`, async () => {
    try {
      const result = await readJson(filePath);
      if (result.success === false) {
        throw new Error(`packaged Sandbox fixture failed: ${result.error}`);
      }
      return result.phase === expectedPhase ? result : undefined;
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
        const outcome = observation.readOutcome();
        if (outcome) {
          throw new Error(`packaged Sandbox App exited before ${expectedPhase}`);
        }
        return undefined;
      }
      throw error;
    }
  }, timeoutMs);
}

async function readFixtureEvidence(filePath) {
  try {
    return (await readFile(filePath, 'utf8')).slice(-OUTPUT_LIMIT);
  } catch (error) {
    if (error?.code === 'ENOENT') return '<not published>';
    return `<unavailable:${error instanceof Error ? error.message : String(error)}>`;
  }
}

async function diagnosticError(error, resultPath, observation) {
  const [stages, result] = await Promise.all([
    readFixtureEvidence(`${resultPath}.stages.log`),
    readFixtureEvidence(resultPath),
  ]);
  return new Error(
    `${error instanceof Error ? error.message : String(error)}`
      + `\nfixture stderr:\n${observation.stderr() || '<empty>'}`
      + `\nfixture stdout:\n${observation.stdout() || '<empty>'}`
      + `\nfixture stages:\n${stages}`
      + `\nfixture result:\n${result}`,
    { cause: error },
  );
}

async function createBuildProject(rootPath) {
  const projectDirectory = path.join(rootPath, 'project');
  await Promise.all([
    mkdir(path.join(projectDirectory, 'sandbox'), { recursive: true }),
    mkdir(path.join(projectDirectory, 'headless-node-runtime/darwin'), { recursive: true }),
  ]);
  await runChecked('pnpm', ['run', 'prepare:headless-node-runtime'], {
    timeoutMs: 120_000,
  });
  await runChecked('pnpm', ['run', 'build:sandbox-runner'], { timeoutMs: 120_000 });
  await runChecked('pnpm', [
    'exec',
    'esbuild',
    path.join(fixtureDirectory, 'main.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--external:electron',
    `--outfile=${path.join(projectDirectory, 'main.cjs')}`,
  ], { timeoutMs: 120_000 });
  await copyFile(
    productionUtilityPath,
    path.join(projectDirectory, 'sandbox/sandboxUtilityProcess.cjs'),
  );
  await Promise.all([
    copyFile(
      productionEvaluatorPath,
      path.join(projectDirectory, 'sandbox/sandboxEvaluatorProcess.cjs'),
    ),
    cp(
      preparedSandboxNodeRuntime,
      path.join(projectDirectory, 'headless-node-runtime/darwin/arm64'),
      { recursive: true },
    ),
  ]);
  const packageManifest = bindElectronVersion(JSON.parse(await readFile(
    path.join(fixtureDirectory, 'package.json'),
    'utf8',
  )));
  await writeFile(
    path.join(projectDirectory, 'package.json'),
    `${JSON.stringify(packageManifest, null, 2)}\n`,
  );
  return projectDirectory;
}

async function buildPackage(projectDirectory, buildRoot) {
  const outputDirectory = path.join(buildRoot, 'macos-output');
  await runChecked('pnpm', [
    'exec',
    'electron-builder',
    '--projectDir',
    projectDirectory,
    '--dir',
    '--mac',
    '--arm64',
    `--config.directories.output=${outputDirectory}`,
  ], { timeoutMs: 180_000 });
  return path.join(
    outputDirectory,
    'mac-arm64/Linnya Formal Sandbox Runner Validation.app',
  );
}

async function inspectPackage(appPath) {
  const fuse = await runChecked(process.execPath, [fuseCliPath, 'read', '--app', appPath]);
  assert.match(fuse.stdout, /RunAsNode is Disabled/u);
  const asarPath = path.join(appPath, 'Contents/Resources/app.asar');
  const asar = await runChecked(process.execPath, [asarCliPath, 'list', asarPath]);
  for (const entry of ['/main.cjs', '/sandbox/sandboxUtilityProcess.cjs', '/package.json']) {
    assert(asar.stdout.split(/\r?\n/u).includes(entry), `app.asar is missing ${entry}`);
  }
  const resourcesPath = path.join(appPath, 'Contents/Resources');
  const packagedEvaluatorPath = path.join(
    resourcesPath,
    'sandbox-runtime/evaluator/sandboxEvaluatorProcess.cjs',
  );
  const packagedNodePath = path.join(
    resourcesPath,
    'headless-node-runtime/darwin/arm64/bin/node',
  );
  await Promise.all([
    readFile(packagedEvaluatorPath),
    readFile(path.join(resourcesPath, 'headless-node-runtime/darwin/arm64/runtime-manifest.json')),
    readFile(path.join(resourcesPath, 'headless-node-runtime/darwin/arm64/LICENSE')),
  ]);
  const nodeVersion = await runChecked(packagedNodePath, ['--version']);
  assert.equal(nodeVersion.stdout.trim(), 'v24.18.1');
  await runChecked('codesign', ['--verify', '--strict', '--verbose=2', packagedNodePath]);
  await runChecked('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
  return {
    runAsNodeDisabled: true,
    asarEntries: 3,
    nodeVersion: nodeVersion.stdout.trim(),
    headlessEvaluatorResourcesVerified: true,
    codeSignatureVerified: true,
  };
}

function spawnPackagedApp(executablePath, input) {
  const child = spawn(executablePath, [
    '--no-error-dialogs',
    '--enable-logging=stderr',
    `--user-data-dir=${input.userDataRoot}`,
  ], {
    detached: true,
    env: {
      ...process.env,
      LINNYA_FORMAL_SANDBOX_RESULT_PATH: input.resultPath,
      LINNYA_FORMAL_SANDBOX_STORAGE_ROOT: input.storageRoot,
      LINNYA_FORMAL_SANDBOX_MODE: input.mode,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { child, observation: observeChild(child) };
}

async function terminateFrozenProcess(instance) {
  if (!instance || !await isSameMacosProcessInstanceAlive(instance)) return;
  try {
    process.kill(instance.pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function teardownPackagedApp(child, observation, frozenInstances) {
  const cleanupFailures = [];
  let descendants = [];
  try {
    descendants = await readMacosDescendantInstances(child.pid);
  } catch (error) {
    cleanupFailures.push(error);
  }
  const identities = [...frozenInstances, ...descendants];
  const main = await readMacosProcessInstance(child.pid).catch(error => {
    cleanupFailures.push(error);
    return undefined;
  });
  try {
    await terminateFrozenProcess(main);
  } catch (error) {
    cleanupFailures.push(error);
  }
  for (const instance of identities.reverse()) {
    try {
      await terminateFrozenProcess(instance);
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  try {
    await waitFor('packaged Sandbox App teardown', async () => {
      const mainAlive = main ? await isSameMacosProcessInstanceAlive(main) : false;
      const descendantAlive = await Promise.all(
        identities.map(isSameMacosProcessInstanceAlive),
      );
      return !mainAlive && descendantAlive.every(alive => !alive);
    }, 10_000);
    await observation.closed;
  } catch (error) {
    cleanupFailures.push(error);
  }
  return cleanupFailures;
}

async function runSuite(executablePath, runRoot) {
  const resultPath = path.join(runRoot, 'suite-result.json');
  const storageRoot = path.join(runRoot, 'suite-storage');
  const { child, observation } = spawnPackagedApp(executablePath, {
    resultPath,
    storageRoot,
    mode: 'suite',
    userDataRoot: path.join(runRoot, 'suite-user-data'),
  });
  let completed = false;
  let scenarioError;
  let summary;
  try {
    const result = await waitForResult(resultPath, observation, 'suite_closed', 90_000);
    const outcome = await observation.closed;
    assert.equal(outcome.code, 0, observation.stderr() || observation.stdout());
    assert.equal(result.packaged, true);
    assert.equal(result.electron, expectedElectronVersion);
    assert.deepEqual(result.normal.value, {
      message: '中文结构化结果',
      nested: { answer: 42 },
    });
    assert.deepEqual(result.normal.logs, [`中文日志:${SOURCE_SENTINEL}`]);
    assert.equal(result.pptCompose.success, true);
    assert.deepEqual(result.pptCompose.logs, ['ppt-compose-production']);
    assert.equal(result.pptCompose.value.mode, 'create');
    assert.equal(result.pptCompose.value.composeCallCount, 1);
    assert.equal(result.pptCompose.value.composeInput.title, '正式打包验证');
    assert.equal(result.pptCompose.value.composeInput.slides.length, 1);
    assert.equal(result.pptCompose.value.layoutTrace.version, 1);
    assert.equal(result.pptCompose.value.layoutTrace.truncated, false);
    assert.equal(result.pptCompose.telemetry.profileId, 'ppt_compose');
    assert.equal(result.pptCompose.telemetry.diagnostics.runnerKind, 'local-process');
    assert.equal(result.heapPositive.success, true);
    assert.equal(result.heapPositive.value, 1_000_000);
    assert.equal(result.heapNegative.success, false);
    assert.equal(result.heapNegative.error.type, 'transport');
    assert(result.heapNegative.diagnostics.stderrBytes > 0);
    assert.equal(result.vmHardTimeout.success, false);
    assert.equal(result.vmHardTimeout.error.type, 'timeout');
    assert.deepEqual(result.vmHardTimeout.logs, ['vm-timeout-before']);
    assert.equal(result.idleOnly.success, false);
    assert.equal(result.idleOnly.error.type, 'timeout');
    assert.equal(result.idleOnly.diagnostics.idleTimeoutTriggered, true);
    assert.equal(result.cancelled.success, false);
    assert.equal(result.cancelled.error.type, 'transport');
    assert.match(result.cancelled.error.message, /宿主取消/u);
    assert.equal(result.identityStress.length, 50);
    assert.deepEqual(
      result.identityStress.map(entry => entry.iteration),
      Array.from({ length: 50 }, (_, index) => index),
    );
    assert.equal(
      new Set(result.identityStress.map(entry => entry.evaluatorPid)).size,
      50,
      'each stress run must use a fresh evaluator process',
    );
    assert.deepEqual(await readdir(result.storageRoot), []);
    completed = true;
    summary = {
      scenarioCount: 7,
      normalEvaluatorPid: result.normal.diagnostics.childPid,
      pptComposeEvaluatorPid: result.pptCompose.telemetry.diagnostics.childPid,
      heapPositiveEvaluatorPid: result.heapPositive.diagnostics.childPid,
      heapNegativeStderrBytes: result.heapNegative.diagnostics.stderrBytes,
      vmTimeoutLogs: result.vmHardTimeout.logs,
      idleTimeoutTriggered: result.idleOnly.diagnostics.idleTimeoutTriggered,
      cancellationObserved: true,
      identityStressRuns: result.identityStress.length,
      identityStressDistinctEvaluatorPids: new Set(
        result.identityStress.map(entry => entry.evaluatorPid),
      ).size,
      storageEntriesAfterSuite: 0,
    };
  } catch (error) {
    scenarioError = await diagnosticError(error, resultPath, observation);
  }
  const cleanupFailures = completed
    ? []
    : await teardownPackagedApp(child, observation, []);
  if (scenarioError || cleanupFailures.length > 0) {
    throw new AggregateError(
      [scenarioError, ...cleanupFailures].filter(Boolean),
      'formal packaged Sandbox suite or teardown failed',
    );
  }
  return summary;
}

async function waitForCrashTree(mainPid, expectedUtilityPid) {
  let lastDescendants = [];
  try {
    return await waitFor('Sandbox Utility 与 Evaluator 外部身份', async () => {
    const descendants = await readMacosDescendantInstances(mainPid);
    lastDescendants = descendants;
    const utility = descendants.find(instance => instance.pid === expectedUtilityPid);
    if (!utility) return undefined;
    const evaluators = descendants.filter(instance => (
      instance.command.includes('sandboxEvaluatorProcess.cjs')
      && instance.parentPid === utility.pid
    ));
    if (evaluators.length !== 1) return undefined;
    const evaluator = evaluators[0];
    if (evaluator.parentPid !== utility.pid || evaluator.processGroupId !== evaluator.pid) return undefined;
    const ownedGroup = descendants.filter(instance => (
      instance.processGroupId === evaluator.processGroupId
    ));
    if (ownedGroup.length === 0) return undefined;
    return { utility, evaluator, ownedGroup, descendants };
    }, 10_000);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; `
        + `mainPid=${mainPid}; utilityPid=${expectedUtilityPid}; `
        + `descendants=${JSON.stringify(lastDescendants)}`,
      { cause: error },
    );
  }
}

async function runUtilityCrash(executablePath, runRoot) {
  const resultPath = path.join(runRoot, 'crash-result.json');
  const storageRoot = path.join(runRoot, 'crash-storage');
  const { child, observation } = spawnPackagedApp(executablePath, {
    resultPath,
    storageRoot,
    mode: 'utility-crash',
    userDataRoot: path.join(runRoot, 'crash-user-data'),
  });
  let completed = false;
  let scenarioError;
  let summary;
  let frozenInstances = [];
  try {
    const ready = await waitForResult(resultPath, observation, 'utility_crash_ready');
    assert.equal(ready.utilityMetrics.filter(metric => metric.pid === ready.utilityPid).length, 1);
    const tree = await waitForCrashTree(child.pid, ready.utilityPid);
    frozenInstances = tree.descendants;
    assert.equal(tree.utility.pid, ready.utilityPid);
    assert.equal(tree.evaluator.parentPid, tree.utility.pid);
    assert.equal(tree.evaluator.processGroupId, tree.evaluator.pid);
    assert(tree.evaluator.command.includes('sandboxEvaluatorProcess.cjs'));
    assert(tree.evaluator.command.includes('/headless-node-runtime/darwin/arm64/bin/node'));
    assert(!tree.evaluator.command.includes(SOURCE_SENTINEL));
    const mainInstance = await readMacosProcessInstance(child.pid);
    assert(mainInstance);
    const launchServices = await readMacosLaunchServicesApplicationRecords();
    assert.equal(launchServices.get(child.pid)?.type, 'Foreground');
    assert.equal(
      launchServices.has(tree.evaluator.pid),
      false,
      'headless Node evaluator must not register a LaunchServices App identity',
    );
    for (const descendant of tree.descendants) {
      assert.notEqual(
        launchServices.get(descendant.pid)?.type,
        'Foreground',
        `Sandbox descendant ${descendant.pid} must not become a foreground App`,
      );
    }
    process.kill(tree.utility.pid, 'SIGKILL');
    await waitFor('强杀 Utility 后 Evaluator owned group 归零', async () => {
      const alive = await Promise.all(tree.ownedGroup.map(isSameMacosProcessInstanceAlive));
      return alive.every(value => !value)
        && !isMacosProcessGroupAlive(tree.evaluator.processGroupId);
    }, 10_000);
    const closed = await waitForResult(resultPath, observation, 'utility_crash_closed', 45_000);
    const outcome = await observation.closed;
    assert.equal(outcome.code, 0, observation.stderr() || observation.stdout());
    assert.equal(closed.crashed.success, false);
    assert.equal(closed.crashed.error.type, 'transport');
    assert.equal(closed.recovered.success, true);
    assert.deepEqual(closed.recovered.value, {
      recovered: true,
      message: '下一代成功',
    });
    assert.notEqual(closed.recovered.diagnostics.childPid, tree.evaluator.pid);
    assert.deepEqual(await readdir(closed.storageRoot), []);
    await waitFor('崩溃场景冻结进程实例全部退出', async () => {
      const alive = await Promise.all(frozenInstances.map(isSameMacosProcessInstanceAlive));
      return alive.every(value => !value);
    }, 10_000);
    completed = true;
    summary = {
      main: mainInstance,
      utility: tree.utility,
      evaluator: tree.evaluator,
      evaluatorLaunchServicesRegistered: false,
      foregroundSandboxDescendants: 0,
      ownedGroupSize: tree.ownedGroup.length,
      frozenDescendantCount: frozenInstances.length,
      evaluatorGroupAfterUtilityKill: 0,
      recoveredEvaluatorPid: closed.recovered.diagnostics.childPid,
      storageEntriesAfterCrash: 0,
    };
  } catch (error) {
    scenarioError = await diagnosticError(error, resultPath, observation);
  }
  const cleanupFailures = completed
    ? []
    : await teardownPackagedApp(child, observation, frozenInstances);
  if (scenarioError || cleanupFailures.length > 0) {
    throw new AggregateError(
      [scenarioError, ...cleanupFailures].filter(Boolean),
      'formal packaged Sandbox Utility crash scenario or teardown failed',
    );
  }
  return summary;
}

const isolatedRoot = await createIsolatedRunRoot();
let succeeded = false;
try {
  const projectDirectory = await createBuildProject(isolatedRoot.path);
  const appPath = await buildPackage(projectDirectory, path.join(isolatedRoot.path, 'build'));
  const packageEvidence = await inspectPackage(appPath);
  const executablePath = path.join(
    appPath,
    'Contents/MacOS/Linnya Formal Sandbox Runner Validation',
  );
  // 两个 App 场景互不依赖。昂贵的 packaged 门即使先发现业务失败，也必须继续运行
  // 外部强杀门并各自 teardown，最后同时报告根因，避免前一个失败遮住进程泄漏。
  let suite;
  let utilityCrash;
  const failures = [];
  if (requestedScenario === 'all' || requestedScenario === 'suite') {
    try {
      suite = await runSuite(executablePath, isolatedRoot.path);
    } catch (error) {
      failures.push(error);
    }
  }
  if (requestedScenario === 'all' || requestedScenario === 'crash') {
    try {
      utilityCrash = await runUtilityCrash(executablePath, isolatedRoot.path);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'formal packaged Sandbox validations failed');
  }
  succeeded = true;
  console.log(JSON.stringify({
    success: true,
    version: 1,
    platform: process.platform,
    architecture: process.arch,
    electron: expectedElectronVersion,
    package: packageEvidence,
    ...(suite ? { suite } : {}),
    ...(utilityCrash ? { utilityCrash } : {}),
  }));
} finally {
  await isolatedRoot.cleanup();
  if (!succeeded) {
    console.error('formal Electron Sandbox runner E2E failed after isolated cleanup');
  }
}
