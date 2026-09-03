import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { app } from 'electron';

import type {
  SandboxRunnerRequest,
  SandboxRunnerResult,
} from '../../../../../src/features/sandbox/definitions/sandboxRunner';
import { SandboxProfileRegistry } from '../../../../../src/features/sandbox/SandboxProfileRegistry';
import { SandboxService } from '../../../../../src/features/sandbox/SandboxService';
import {
  createElectronSandboxProductionScope,
} from '../../../../../src/electron-main/sandbox-runtime/production-runtime';
import {
  resolveSandboxEvaluatorRuntime,
} from '../../../../../src/app-hosts/linnya/adapters/sandbox/production-runtime';
import {
  parseWindowsNativeRuntimeManifest,
  WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
} from '../../../../../src/infra/adapters/local-process-runtime/windows/definitions/windowsNativeRuntimeManifest';
import { pptComposeProfile } from '@plugin/slides/backend-sandbox';

const RESULT_PATH = process.env.LINNYA_FORMAL_SANDBOX_RESULT_PATH;
const STORAGE_ROOT = process.env.LINNYA_FORMAL_SANDBOX_STORAGE_ROOT;
const RUN_MODE = process.env.LINNYA_FORMAL_SANDBOX_MODE ?? 'suite';
const SOURCE_SENTINEL = 'LINNYA_PRIVATE_SOURCE_SENTINEL_9f7c6a';
const HEAP_PRESSURE_SOURCE = [
  'const retained = [];',
  'for (let index = 0; index < 1000000; index += 1) {',
  "  retained.push({ index, text: 'heap-pressure-' + index });",
  '}',
  'return retained.length;',
].join('\n');

if (!RESULT_PATH || !path.isAbsolute(RESULT_PATH)) {
  throw new Error('LINNYA_FORMAL_SANDBOX_RESULT_PATH must be an absolute path');
}
if (!STORAGE_ROOT || !path.isAbsolute(STORAGE_ROOT)) {
  throw new Error('LINNYA_FORMAL_SANDBOX_STORAGE_ROOT must be an absolute path');
}

function publishResult(value: unknown): void {
  const pendingPath = `${RESULT_PATH}.${process.pid}.pending`;
  fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
  fs.writeFileSync(pendingPath, JSON.stringify(value));
  fs.renameSync(pendingPath, RESULT_PATH);
}

function appendStage(stage: string): void {
  fs.appendFileSync(`${RESULT_PATH}.stages.log`, `${Date.now()}\t${stage}\n`);
}

function createRequest(input: {
  readonly name: string;
  readonly source: string;
  readonly timeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxHeapMb?: number;
}): SandboxRunnerRequest {
  return {
    runId: `formal-sandbox-${input.name}-${randomUUID()}`,
    profileId: 'formal-production-scope',
    language: 'javascript',
    source: input.source,
    globals: {},
    bindings: [],
    limits: {
      timeoutMs: input.timeoutMs ?? 10_000,
      maxLogLines: 100,
      maxLogLineLength: 2_000,
      maxResultBytes: 256 * 1024,
      maxSourceBytes: 128 * 1024,
      maxCapabilityPayloadBytes: 256 * 1024,
      maxHeapMb: input.maxHeapMb ?? 128,
      idleTimeoutMs: input.idleTimeoutMs ?? 12_000,
    },
    capabilities: [],
  };
}

async function createProductionScope() {
  const evaluatorRuntime = await resolveSandboxEvaluatorRuntime({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    mainBundleDirectory: __dirname,
    platform: process.platform,
    architecture: process.arch,
  });
  if (process.platform === 'win32') {
    if (process.arch !== 'x64') {
      throw new Error(`formal Windows Sandbox fixture does not support ${process.arch}`);
    }
    const manifestPath = path.join(
      process.resourcesPath,
      'command-runtime',
      'windows',
      process.arch,
      WINDOWS_OWNED_PIPE_NATIVE_MANIFEST_FILE_NAME,
    );
    const manifest = parseWindowsNativeRuntimeManifest(JSON.parse(
      fs.readFileSync(manifestPath, 'utf8'),
    ));
    if (manifest.architecture !== process.arch || manifest.application_version !== app.getVersion()) {
      throw new Error('formal Windows Sandbox runtime identity does not match packaged App');
    }
    return createElectronSandboxProductionScope({
      storageRoot: STORAGE_ROOT,
      utilityPath: path.join(__dirname, 'sandbox', 'sandboxUtilityProcess.cjs'),
      utilityEnvironment: Object.freeze({}),
      evaluator: evaluatorRuntime.launch,
      platformRuntime: {
        schema_version: 1,
        platform: 'win32',
        manifest_path: manifestPath,
        expected_runtime_version: manifest.runtime_version,
        expected_application_version: manifest.application_version,
        trust: { kind: 'development' },
      },
    });
  }
  if (process.platform !== 'darwin') {
    throw new Error(`formal Sandbox fixture does not support ${process.platform}`);
  }
  return createElectronSandboxProductionScope({
    storageRoot: STORAGE_ROOT,
    utilityPath: path.join(__dirname, 'sandbox', 'sandboxUtilityProcess.cjs'),
    utilityEnvironment: Object.freeze({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }),
    evaluator: evaluatorRuntime.launch,
    platformRuntime: { schema_version: 1, platform: 'darwin' },
  });
}

function requireStorageRootEmpty(stage: string): void {
  const entries = fs.existsSync(STORAGE_ROOT) ? fs.readdirSync(STORAGE_ROOT) : [];
  if (entries.length !== 0) {
    throw new Error(`${stage} left Sandbox run directories: ${entries.join(',')}`);
  }
}

async function executeScenario(
  scope: Awaited<ReturnType<typeof createProductionScope>>,
  name: string,
  request: SandboxRunnerRequest,
  options?: { readonly abortSignal?: AbortSignal },
): Promise<SandboxRunnerResult> {
  appendStage(`${name}_started`);
  const result = await scope.execute(request, options);
  requireStorageRootEmpty(name);
  appendStage(`${name}_settled`);
  return result;
}

async function executePptComposeScenario(
  scope: Awaited<ReturnType<typeof createProductionScope>>,
) {
  appendStage('ppt_compose_started');
  const registry = new SandboxProfileRegistry();
  registry.register(pptComposeProfile);
  const service = new SandboxService(registry, scope);
  const result = await service.execute({
    profileId: 'ppt_compose',
    language: 'javascript',
    source: [
      "console.log('ppt-compose-production');",
      'const slide = createSlide();',
      "const title = createText('生产 Sandbox');",
      'title.fontSize = 24;',
      'slide.add(title);',
      "compose({ title: '正式打包验证', slides: [slide] });",
    ].join('\n'),
    inputs: {
      SLIDE_W: 10,
      SLIDE_H: 5.625,
      CHART_PRESETS: ['clean-column'],
    },
  });
  requireStorageRootEmpty('ppt_compose');
  appendStage('ppt_compose_settled');
  return result;
}

async function runSuite(): Promise<void> {
  const scope = await createProductionScope();
  const normal = await executeScenario(scope, 'normal', createRequest({
    name: 'normal',
    source: [
      `console.log('中文日志:${SOURCE_SENTINEL}');`,
      "return { message: '中文结构化结果', nested: { answer: 42 } };",
    ].join('\n'),
  }));
  const pptCompose = await executePptComposeScenario(scope);
  const heapPositive = await executeScenario(scope, 'heap_positive', createRequest({
    name: 'heap-positive',
    source: HEAP_PRESSURE_SOURCE,
    timeoutMs: 20_000,
    idleTimeoutMs: 25_000,
    maxHeapMb: 256,
  }));
  const heapNegative = await executeScenario(scope, 'heap_negative', createRequest({
    name: 'heap-negative',
    source: HEAP_PRESSURE_SOURCE,
    timeoutMs: 20_000,
    idleTimeoutMs: 25_000,
    maxHeapMb: 32,
  }));
  const vmHardTimeout = await executeScenario(scope, 'vm_hard_timeout', createRequest({
    name: 'vm-hard-timeout',
    source: "console.log('vm-timeout-before'); while (true) {}",
    timeoutMs: 250,
    idleTimeoutMs: 5_000,
  }));
  const idleOnly = await executeScenario(scope, 'idle_only', createRequest({
    name: 'idle-only',
    source: 'while (true) {}',
    timeoutMs: 5_000,
    idleTimeoutMs: 250,
  }));
  const abortController = new AbortController();
  const cancellation = executeScenario(scope, 'abort_signal_cancel', createRequest({
    name: 'abort-signal-cancel',
    source: 'while (true) {}',
    timeoutMs: 30_000,
    idleTimeoutMs: 35_000,
  }), { abortSignal: abortController.signal });
  setTimeout(() => abortController.abort(), 500);
  const cancelled = await cancellation;
  const identityStress = [];
  for (let index = 0; index < 50; index += 1) {
    const result = await executeScenario(scope, `identity_stress_${index}`, createRequest({
      name: `identity-stress-${index}`,
      source: `return { iteration: ${index} };`,
    }));
    if (!result.success
      || typeof result.value !== 'object'
      || result.value === null
      || Reflect.get(result.value, 'iteration') !== index) {
      throw new Error(`Sandbox identity stress iteration ${index} failed`);
    }
    identityStress.push({
      iteration: index,
      evaluatorPid: result.diagnostics.childPid,
    });
  }
  await scope.endOwnerAndWait();
  requireStorageRootEmpty('suite owner end');
  publishResult({
    success: true,
    version: 1,
    phase: 'suite_closed',
    platform: process.platform,
    architecture: process.arch,
    electron: process.versions.electron,
    packaged: app.isPackaged,
    storageRoot: STORAGE_ROOT,
    sourceSentinel: SOURCE_SENTINEL,
    normal,
    pptCompose,
    heapPositive,
    heapNegative,
    vmHardTimeout,
    idleOnly,
    cancelled,
    identityStress,
  });
}

function readSandboxUtilityMetrics(): readonly {
  readonly pid: number;
  readonly type: string;
  readonly creationTime: number;
  readonly serviceName?: string;
  readonly name?: string;
}[] {
  return app.getAppMetrics().flatMap(metric => {
    if (metric.type !== 'Utility') return [];
    return [{
      pid: metric.pid,
      type: metric.type,
      creationTime: metric.creationTime,
      ...(metric.serviceName ? { serviceName: metric.serviceName } : {}),
      ...(metric.name ? { name: metric.name } : {}),
    }];
  });
}

async function waitForSandboxUtilityPid(): Promise<{
  readonly utilityPid: number;
  readonly metrics: ReturnType<typeof readSandboxUtilityMetrics>;
}> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const metrics = readSandboxUtilityMetrics();
    const named = metrics.filter(metric => (
      metric.name === 'Linnya Sandbox Runner'
      || metric.serviceName === 'Linnya Sandbox Runner'
    ));
    if (named.length === 1) {
      const utilityPid = named[0]?.pid;
      if (Number.isSafeInteger(utilityPid) && utilityPid !== undefined && utilityPid > 0) {
        return { utilityPid, metrics };
      }
    }
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Sandbox Utility identity unavailable: ${JSON.stringify(readSandboxUtilityMetrics())}`);
}

async function runUtilityCrash(): Promise<void> {
  const scope = await createProductionScope();
  appendStage('utility_crash_execution_started');
  const crashedExecution = scope.execute(createRequest({
    name: 'utility-crash',
    source: `/* ${SOURCE_SENTINEL} */ while (true) {}`,
    timeoutMs: 30_000,
    idleTimeoutMs: 35_000,
  }));
  // Windows 由外部控制器根据 Evaluator 标记和父链反查 Utility。getAppMetrics()
  // 会同时列出 Electron 网络服务，不能把“当前唯一 Utility”当作正式进程身份。
  const utility = process.platform === 'win32'
    ? { metrics: readSandboxUtilityMetrics() }
    : await waitForSandboxUtilityPid();
  publishResult({
    success: true,
    version: 1,
    phase: 'utility_crash_ready',
    platform: process.platform,
    architecture: process.arch,
    storageRoot: STORAGE_ROOT,
    sourceSentinel: SOURCE_SENTINEL,
    ...('utilityPid' in utility ? { utilityPid: utility.utilityPid } : {}),
    utilityMetrics: utility.metrics,
  });

  const crashed = await crashedExecution;
  requireStorageRootEmpty('utility crash');
  const recovered = await executeScenario(scope, 'post_crash_generation', createRequest({
    name: 'post-crash-generation',
    source: "return { recovered: true, message: '下一代成功' };",
  }));
  await scope.endOwnerAndWait();
  requireStorageRootEmpty('utility crash owner end');
  publishResult({
    success: true,
    version: 1,
    phase: 'utility_crash_closed',
    platform: process.platform,
    architecture: process.arch,
    electron: process.versions.electron,
    packaged: app.isPackaged,
    storageRoot: STORAGE_ROOT,
    sourceSentinel: SOURCE_SENTINEL,
    ...('utilityPid' in utility ? { utilityPid: utility.utilityPid } : {}),
    utilityMetrics: utility.metrics,
    crashed,
    recovered,
  });
}

export async function runValidationApp(): Promise<void> {
  appendStage('normal_app_entered');
  await app.whenReady();
  appendStage('electron_ready');
  try {
    if (RUN_MODE === 'suite') await runSuite();
    else if (RUN_MODE === 'utility-crash') await runUtilityCrash();
    else throw new Error(`unsupported formal Sandbox mode: ${RUN_MODE}`);
    appendStage('result_published');
    app.quit();
  } catch (error: unknown) {
    appendStage('fixture_failed');
    publishResult({
      success: false,
      version: 1,
      phase: 'failed',
      platform: process.platform,
      architecture: process.arch,
      storageRoot: STORAGE_ROOT,
      error: error instanceof Error ? error.stack : String(error),
    });
    app.exit(1);
  }
}

app.on('window-all-closed', () => undefined);
