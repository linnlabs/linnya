import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import { z } from 'zod';
import { loadBackendPluginsFromDisk } from '../../../src/electron-main/plugins/loader/diskPluginLoader';
import { readMacosDescendantInstances, isSameMacosProcessInstanceAlive } from '../shell-tool/harness/macosElectronProcessObservation.mjs';
import { readMacosProcessInstance } from '../shell-tool/harness/productionAgentProcessTree.mjs';
import { readSealedCanvasCliObservation, prepareCanvasCliObservation, CANVAS_CLI_FROZEN_PRODUCER_SOURCE,
  CANVAS_CLI_PRODUCER_FILES, CanvasCliProductionBuildSchema, CanvasCliObservationActivationSchema,
  CanvasCliObservationSessionSchema } from '../../../packages/plugins/canvas/dev/agent-evaluation/cli-observation';
import { BuildRecordSchema, CpuProofSchema, PayloadsSchema, PreparedSmokeSchema, ProcessInstanceSchema, ProcessInstancesSchema, SmokeRequestSchema,
  type PreparedSmoke, type ProcessInstance, type SmokeRequest } from './definitions';

const ownerRoot = fileURLToPath(new URL('../../../', import.meta.url));
const loaderSource = path.join(ownerRoot, 'src/electron-main/plugins/loader/diskPluginLoader.ts');
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));
const save = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const digest = (file: string) => hash(readFileSync(file));
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function git(root: string, ...args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
async function signalObservedProcess(instance: ProcessInstance, signal: 'SIGTERM' | 'SIGKILL') {
  if (!await isSameMacosProcessInstanceAlive(instance)) return;
  try { process.kill(instance.pid, signal); }
  catch (error) { if (!(error instanceof Error) || Reflect.get(error, 'code') !== 'ESRCH') throw error; }
}

/** App级组合根验证真实Host loader；插件dev不反向依赖Host内部。此处不调用CLI或工厂。 */
function verifyCpuLoad(artifact: string, outputFile: string, appVersion: string) {
  const loaded = loadBackendPluginsFromDisk({ directPluginDirs: [artifact], appVersion });
  assert.equal(loaded.length, 1);
  const wrapper = path.join(artifact, 'dist/backend/index.cjs'), originalFile = path.join(artifact, 'dist/backend/index.production.cjs');
  const require = createRequire(wrapper), original: unknown = require(originalFile), observed: unknown = require(wrapper);
  assert.ok(record(original) && record(observed) && record(original.backendPlugin) && record(observed.backendPlugin));
  assert.equal(loaded[0].contribution, observed.backendPlugin);
  const otherExports = Object.keys(original).filter(key => key !== 'backendPlugin');
  const otherContributions = Object.keys(original.backendPlugin).filter(key => key !== 'pluginCli');
  for (const key of otherExports) assert.equal(original[key], observed[key]);
  for (const key of otherContributions) assert.equal(original.backendPlugin[key], observed.backendPlugin[key]);
  assert.notEqual(original.backendPlugin.pluginCli, observed.backendPlugin.pluginCli);
  const proof = CpuProofSchema.parse({ namedBackendPluginSelected: true, nonCliReferencesPreserved: true,
    originalBackendSha256: digest(originalFile), wrapperSha256: digest(wrapper), proofPid: process.pid, otherExports, otherContributions });
  save(outputFile, { ...proof, loaderSource, loaderSourceSha256: digest(loaderSource), factoryOrCliCalled: false,
    appStarted: false, qualification: 'CPU actual compiled-module references only' });
  return proof;
}

function verifyFrozenBuild(request: SmokeRequest) {
  const repository = path.resolve(request.repositoryRoot);
  assert.equal(git(repository, 'rev-parse', 'HEAD'), CANVAS_CLI_FROZEN_PRODUCER_SOURCE);
  assert.equal(git(repository, 'status', '--porcelain'), '');
  const original = BuildRecordSchema.parse(readJson(request.buildProvenanceFile));
  assert.equal(original.sourceRevision, CANVAS_CLI_FROZEN_PRODUCER_SOURCE);
  assert.equal(hash(execFileSync('git', ['show', `${original.sourceRevision}:src/electron-main/plugins/loader/diskPluginLoader.ts`], { cwd: repository })), digest(loaderSource));
  for (const row of original.hostCanvasAndDependencyHashes) {
    assert.equal(statSync(row.path).size, row.bytes); assert.equal(digest(row.path), row.sha256);
  }
  const log = readFileSync(request.buildLogFile, 'utf8');
  assert.ok(log.includes('startElectronDevelopment.mjs --build-only') && log.includes('[dev:plugin-canvas-render-preload] ready'));
  return original;
}

async function prepare(request: SmokeRequest) {
  const root = path.resolve(request.outputDirectory), repository = path.resolve(request.repositoryRoot);
  const original = verifyFrozenBuild(request);
  assert.equal(git(ownerRoot, 'status', '--porcelain'), '', 'Observer source must be committed before preparation');
  mkdirSync(root, { mode: 0o700 });
  const plugin = path.join(repository, 'packages/plugins/canvas'), sources = path.join(root, 'producer-source');
  for (const [relative, expected] of Object.entries(CANVAS_CLI_PRODUCER_FILES)) {
    const file = path.join(plugin, relative); assert.equal(digest(file), expected);
    const target = path.join(sources, relative); mkdirSync(path.dirname(target), { recursive: true }); cpSync(file, target, { errorOnExist: true, force: false });
  }
  const formalLog = path.join(root, 'official-build.log'), originalProof = path.join(root, 'original-build-provenance.json');
  cpSync(request.buildLogFile, formalLog, { errorOnExist: true, force: false });
  cpSync(request.buildProvenanceFile, originalProof, { errorOnExist: true, force: false });
  const backendSha = digest(path.join(plugin, 'dist/backend/index.cjs')), buildFile = path.join(root, 'production-build.json');
  // 原见证在正式成功后写入，其mtime是构建完成的保守上界；原件另存而非重标当前编译。
  save(buildFile, CanvasCliProductionBuildSchema.parse({ schemaVersion: 1, kind: 'canvas-cli-official-production-build',
    sourceRevision: original.sourceRevision, sourceDirty: false, originalBackendSha256: backendSha, producerSourceDirectory: sources,
    command: ['node', 'scripts/development/orchestration/startElectronDevelopment.mjs', '--build-only'], exitCode: original.buildOnlyCommandExitCode,
    completedAt: statSync(request.buildProvenanceFile).mtimeMs, logFile: formalLog, logSha256: digest(formalLog) }));
  const observationSourceRevision = git(ownerRoot, 'rev-parse', 'HEAD');
  const cpuArtifact = path.join(root, 'cpu-artifact'), preparedArtifact = path.join(root, 'prepared-artifact');
  const evidenceDirectory = path.join(root, 'runtime-evidence'), installedArtifact = path.join(root, 'installed-artifact');
  for (const [outputDirectory, evidence] of [[cpuArtifact, path.join(root, 'cpu-evidence')], [preparedArtifact, evidenceDirectory]]) {
    await prepareCanvasCliObservation({ productionPluginDirectory: plugin, outputDirectory, evidenceDirectory: evidence,
      productionSourceRevision: original.sourceRevision, observationSourceRevision });
  }
  const appVersion = z.object({ version: z.string() }).parse(readJson(path.join(repository, 'package.json'))).version;
  const cpuProofFile = path.join(root, 'cpu-load-proof.json'); verifyCpuLoad(cpuArtifact, cpuProofFile, appVersion);
  cpSync(preparedArtifact, installedArtifact, { recursive: true, errorOnExist: true, force: false });
  const rendererDirectory = path.join(root, 'renderer'); cpSync(request.frozenRendererDirectory, rendererDirectory, { recursive: true, errorOnExist: true, force: false });
  const index = path.join(rendererDirectory, 'index.html'), html = readFileSync(index, 'utf8');
  // 只移除旧验收桥自有标签；N0不挂画布、不发送命令，也不复用带旧nonce的桥。
  writeFileSync(index, html.replace(/<script type="module" data-canvas-evaluation-bridge="[^\"]+"[^>]+><\/script>\n/g, ''));
  const prepared = z.object({ payloadManifestSha256: z.string(), wrapperSha256: z.string() }).parse(readJson(path.join(preparedArtifact, 'cli-observation-build.json')));
  const instanceRoot = path.join(root, 'instance'); mkdirSync(instanceRoot);
  const value = PreparedSmokeSchema.parse({ request, sourceRevision: original.sourceRevision, observationSourceRevision,
    buildFile, buildSha256: digest(buildFile), preparedArtifact, installedArtifact, evidenceDirectory, instanceRoot, rendererDirectory,
    payloadManifestSha256: prepared.payloadManifestSha256, originalBackendSha256: backendSha, wrapperSha256: prepared.wrapperSha256,
    cpuProofFile, loaderSourceSha256: digest(loaderSource) });
  save(path.join(root, 'prepared.json'), value);
  save(path.join(root, 'preparation-origin.json'), { originalBuildProof: originalProof, sha256: digest(originalProof),
    appStarted: false, modelsRequested: 0, editorOriginalArtifactModified: false, actualRendererIndexOnlyRemovedOwnedBridge: true });
  console.log(JSON.stringify({ prepared: true, outputDirectory: root, appStarted: false, modelsRequested: 0 }));
}

function verifyInstalled(value: PreparedSmoke, observed: boolean) {
  const payloads = PayloadsSchema.parse(readJson(path.join(value.preparedArtifact, 'cli-observation-payloads.json'))).payloads;
  for (const row of payloads) assert.equal(digest(path.join(value.installedArtifact, observed ? row.observedPath : row.originalPath)), row.sha256);
  if (observed) assert.equal(digest(path.join(value.installedArtifact, 'dist/backend/index.cjs')), value.wrapperSha256);
  return payloads.length;
}
function restoreInstalled(value: PreparedSmoke) {
  verifyInstalled(value, true);
  const backend = path.join(value.installedArtifact, 'dist/backend'), index = path.join(backend, 'index.cjs'), sidecar = path.join(backend, 'index.production.cjs');
  assert.equal(digest(index), value.wrapperSha256); assert.equal(digest(sidecar), value.originalBackendSha256);
  cpSync(sidecar, index); unlinkSync(sidecar);
  return { controlledIndexRestored: true, ownedSidecarRemoved: true, originalPayloadsVerified: verifyInstalled(value, false) };
}

/** 沿用parallel-desktop gate的正式Main/profile/进程观察路径；只启动这一份冻结App，关闭由真实CmdQ完成。 */
async function launch(value: PreparedSmoke) {
  assert.equal(process.platform, 'darwin');
  verifyFrozenBuild(value.request);
  const root = path.resolve(value.request.outputDirectory), appLog = path.join(root, 'app.log');
  assert.ok(!existsSync(appLog) && !existsSync(value.evidenceDirectory));
  assert.equal(digest(loaderSource), value.loaderSourceSha256);
  verifyInstalled(value, true);
  const cpu = CpuProofSchema.parse(readJson(value.cpuProofFile)); assert.equal(cpu.originalBackendSha256, value.originalBackendSha256);
  const require = createRequire(path.join(value.request.repositoryRoot, 'package.json'));
  const electron = z.string().parse(require('electron'));
  const server = await preview({ configFile: path.join(value.request.repositoryRoot, 'vite.config.mjs'), root: value.request.repositoryRoot,
    build: { outDir: value.rendererDirectory }, preview: { host: '127.0.0.1', port: 0, proxy: {},
      headers: { 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Opener-Policy': 'same-origin' } } });
  try {
    const address = server.httpServer.address(); assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`, env = { ...process.env };
    for (const key of ['LINNYA_API_PORT', 'LINNYA_WORKSPACE_DIR', 'LINNYA_CLI_CONNECTION_FILE', 'LINNYA_PLUGIN_ROOT',
      'LINNYA_CONVERSATION_ROOT', 'ELECTRON_RUN_AS_NODE', 'LINNYA_BUNDLED_PLUGIN_ROOT', 'LINNYA_RESOLVED_BUNDLED_PLUGIN_ROOT']) delete env[key];
    const appVersion = z.object({ version: z.string() }).parse(readJson(path.join(value.request.repositoryRoot, 'package.json'))).version;
    const command = [path.join(value.request.repositoryRoot, 'dist/main/main.cjs')];
    writeFileSync(appLog, '', { flag: 'wx', mode: 0o600 });
    const app = spawn(electron, command, { cwd: value.request.repositoryRoot, env: { ...env, NODE_ENV: 'development', LINNYA_DEV_MODE: 'true',
      APP_VERSION: appVersion, LINNYA_DEV_INSTANCE_ROOT: value.instanceRoot, VITE_DEV_SERVER_URL: origin,
      MODEL_REGISTRY_DEFAULTS_PATH: path.join(value.request.repositoryRoot, 'src/domains/model-catalog/features/default-catalog/assets/default_models.json'),
      LINNYA_API_PORT: '0', LINNYA_DISABLE_UPDATE_CHECKS: '1', LINNYA_PLUGIN_SEED_BUNDLED: '0',
      LINNYA_PLUGIN_BACKEND_LOADING: 'disk-only', LINNYA_PLUGIN_RENDERER_BUNDLE: 'disk',
      LINNYA_PLUGIN_DIRECT_DIRS: value.installedArtifact, LINNYA_PLUGIN_BACKEND_DIRECT_DIRS: value.installedArtifact }, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.ok(app.pid); const mainPid = app.pid;
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      app.once('error', reject); app.once('exit', (code, signal) => resolve({ code, signal }));
    });
    void exit.catch(() => {});
    for (const stream of [app.stdout, app.stderr]) stream.on('data', (bytes: Buffer) => appendFileSync(appLog, bytes));
    const owned = new Map<string, ProcessInstance>();
    let main: ProcessInstance | null = null;
    // 与正式startup-failure gate相同：Main退出前冻结实际后代，重挂父进程后仍按原身份收口。
    const rememberOwned = async () => {
      if (!main || !await isSameMacosProcessInstanceAlive(main)) return;
      for (const row of ProcessInstancesSchema.parse(await readMacosDescendantInstances(main.pid)))
        owned.set(`${row.pid}:${row.startedAt}:${row.command}`, row);
    };
    try {
      main = ProcessInstanceSchema.parse(await readMacosProcessInstance(mainPid));
      save(path.join(root, 'launch.json'), { command: [electron, ...command], mainPid, origin, instanceRoot: value.instanceRoot,
        pluginDirectory: value.installedArtifact, startedAt: Date.now(), appLog, modelsRequested: 0 });
      const deadline = Date.now() + 60_000; let observedAt = 0, backendPid = 0;
      while (Date.now() < deadline) {
        assert.equal(app.exitCode, null, 'App exited before activation');
        assert.equal(app.signalCode, null, 'App exited before activation');
        await rememberOwned();
        const text = readFileSync(appLog, 'utf8'), match = text.match(/App Server ready\. (\{"pid":\d+,"apiPort":\d+\})/);
        if (match && text.includes('[Desktop] ready') && text.includes(`[plugin-loader] Loaded backend plugin canvas@0.1.0 from ${value.installedArtifact}/dist/backend/index.cjs`)) {
          backendPid = z.object({ pid: z.number().int().positive() }).parse(JSON.parse(match[1])).pid;
          observedAt = Date.now(); break;
        }
        await pause(100);
      }
      assert.ok(backendPid, 'N0 Host activation timed out');
      const descendants = [...owned.values()];
      assert.ok(descendants.some(row => row.pid === backendPid));
      save(path.join(root, 'owned-processes.json'), { mainPid, descendants });
      const session = CanvasCliObservationSessionSchema.parse(readJson(path.join(value.evidenceDirectory, 'session.json')));
      assert.equal(session.pid, backendPid); assert.equal(session.originalBackendSha256, value.originalBackendSha256);
      assert.equal(digest(path.join(value.installedArtifact, 'dist/backend/index.cjs')), value.wrapperSha256);
      assert.equal(digest(path.join(value.installedArtifact, 'dist/backend/index.production.cjs')), value.originalBackendSha256);
      const activationFile = path.join(root, 'activation.json');
      save(activationFile, CanvasCliObservationActivationSchema.parse({ schemaVersion: 1, kind: 'canvas-cli-observation-activation',
        backendPid, observedAt, evidenceDirectory: value.evidenceDirectory, preparedArtifactDirectory: value.preparedArtifact,
        productionBuildProvenanceFile: value.buildFile, productionBuildProvenanceSha256: value.buildSha256,
        productionSourceRevision: value.sourceRevision, observationSourceRevision: value.observationSourceRevision,
        originalBackendSha256: value.originalBackendSha256, payloadManifestSha256: value.payloadManifestSha256,
        wrapperSha256: value.wrapperSha256, namedBackendPluginSelected: cpu.namedBackendPluginSelected,
        nonCliReferencesPreserved: cpu.nonCliReferencesPreserved }));
      console.log(JSON.stringify({ readyForNativeCmdQ: true, mainPid, backendPid, outputDirectory: root, modelsRequested: 0 }));
      while (app.exitCode === null && app.signalCode === null) { await rememberOwned(); await pause(100); }
      const ended = await exit; assert.equal(ended.code, 0); assert.equal(ended.signal, null);
      const allDescendants = [...owned.values()];
      const end = Date.now() + 15_000;
      while (Date.now() < end && (await Promise.all(allDescendants.map(isSameMacosProcessInstanceAlive))).some(Boolean)) await pause(100);
      assert.ok((await Promise.all(allDescendants.map(isSameMacosProcessInstanceAlive))).every(alive => !alive), 'owned descendants remain');
      const sealed = await readSealedCanvasCliObservation({ directory: value.evidenceDirectory, activationFile });
      assert.equal(sealed.invocations.length, 0);
      const restored = restoreInstalled(value);
      save(path.join(root, 'qualification.json'), { kind: 'N0-load-normal-exit-seal-only', status: 'passed', exit: ended,
        backendPid, mainPid, sealedInvocations: sealed.invocations.length, ...restored, ownedDescendantsAlive: 0,
        modelsRequested: 0, cliPrepareOrExecuteProven: false, performanceProven: false, sourceRevision: value.sourceRevision,
        evidenceFiles: sealed.evidenceFiles, appLogSha256: digest(appLog), completedAt: Date.now() });
      console.log(JSON.stringify({ N0Passed: true, modelsRequested: 0, qualification: path.join(root, 'qualification.json') }));
    } catch (error) {
      // 沿用parallel-desktop失败收口：只清已冻结且PID/start/command仍相同的本轮实例。
      await rememberOwned();
      if (main) await signalObservedProcess(main, 'SIGTERM');
      await Promise.race([exit, pause(5000)]);
      const identities = [...(main ? [main] : []), ...owned.values()];
      for (const row of [...identities].reverse()) await signalObservedProcess(row, 'SIGKILL');
      const end = Date.now() + 10_000;
      while (Date.now() < end && (await Promise.all(identities.map(isSameMacosProcessInstanceAlive))).some(Boolean)) await pause(100);
      const alive = await Promise.all(identities.map(isSameMacosProcessInstanceAlive));
      save(path.join(root, 'failed-cleanup.json'), { status: 'failed', originalFailure: String(error), identities,
        remainingOwned: identities.filter((_, index) => alive[index]), mainIdentityObserved: main !== null,
        normalExitQualification: false, evidenceRetained: true });
      if (alive.some(Boolean)) throw new Error(`Owned processes remain after failed N0 cleanup; original failure: ${String(error)}`);
      throw error;
    }
  } finally { await server.close(); }
}

const [command, file] = process.argv.slice(2);
if (!file || process.argv.length !== 4) throw new Error('usage: run.ts prepare REQUEST.json | launch PREPARED.json');
if (command === 'prepare') await prepare(SmokeRequestSchema.parse(readJson(file)));
else if (command === 'launch') await launch(PreparedSmokeSchema.parse(readJson(file)));
else throw new Error('Only fixed N0 prepare/launch commands are supported');
