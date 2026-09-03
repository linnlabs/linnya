import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { app } from 'electron';
import { resolveElectronLocalProcessPlatformRuntime } from '../../../../../src/electron-main/local-process-runtime/production-runtime';
import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandOriginToolCallIdSchema,
} from '@app/schemas/commands';

import { bootstrapBuiltinPluginLifecycle } from '../../../../../src/app-hosts/linnya/plugin-registry/builtin';
import { SQLiteEventStore } from '../../../../../src/app-hosts/linnya/adapters/persistence/event-store';
import { createCommandRunPermissionSnapshot } from '../../../../../src/domains/commands/features/permission-settings';
import { parseCommandOutputArtifactManifest } from '../../../../../src/domains/commands/definitions/commandOutputArtifact';
import { createCommandApprovalHost } from '../../../../../src/app-hosts/linnya/adapters/commands/approval-host';
import {
  createElectronCommandProductionScope,
  resolveCommandRuntimeFacts,
} from '../../../../../src/electron-main/commands/production-runtime';
import { createConversationRouteLifecycle } from '../../../../../src/electron-main/routes/orchestration/createConversationRouteLifecycle';
import { DatabaseService } from '../../../../../src/electron-main/services/database';
import type { HostProcessEnvironment } from '../../../../../src/infra/adapters/command-runtime/environment';
import { createCollectingCommandExecutionAuditPort } from '../../functions/createCollectingCommandExecutionAuditPort';

interface CorpusCase {
  readonly id: string;
  readonly command: string;
  readonly expectedExitCode: number;
  readonly stdoutIncludes: readonly string[];
  readonly stderrIncludes: readonly string[];
}

const CONVERSATION_ID = CommandConversationIdSchema.parse(
  'conversation-windows-current-host-cli-corpus',
);
const AGENT_RUN_ID = CommandAgentRunIdSchema.parse(
  'agent-run-windows-current-host-cli-corpus',
);
const ENVIRONMENT_REVISION = 'windows-current-host-cli-corpus-v1';
const MISSING_COMMAND = 'linnya_missing_cli_7b972af6';

const CORPUS: readonly CorpusCase[] = Object.freeze([
  {
    id: 'app-owner-environment',
    command: [
      'if ($env:PC54_USER_CLI_SESSION -ne "visible-before-app-owner-capture") { exit 81 }',
      'if (Test-Path Env:LINNYA_PC54_LATE_INTERNAL) { exit 82 }',
      '[Console]::Out.WriteLine("PC54_APP_OWNER_ENVIRONMENT_OK")',
      'exit 0',
    ].join('; '),
    expectedExitCode: 0,
    stdoutIncludes: ['PC54_APP_OWNER_ENVIRONMENT_OK'],
    stderrIncludes: [],
  },
  {
    id: 'powershell',
    command: [
      '[Console]::Out.WriteLine("PS_STDOUT_中文:参数 空格")',
      '[Console]::Out.WriteLine("PS_CWD:" + [Environment]::CurrentDirectory)',
      '[Console]::Error.WriteLine("PS_STDERR_中文")',
      'exit 0',
    ].join('; '),
    expectedExitCode: 0,
    stdoutIncludes: ['PS_STDOUT_中文:参数 空格'],
    stderrIncludes: ['PS_STDERR_中文'],
  },
  {
    id: 'where-exe',
    command: '& where.exe powershell.exe; exit $LASTEXITCODE',
    expectedExitCode: 0,
    stdoutIncludes: ['WindowsPowerShell\\v1.0\\powershell.exe'],
    stderrIncludes: [],
  },
  {
    id: 'curl-exe',
    command: '& curl.exe --version; exit $LASTEXITCODE',
    expectedExitCode: 0,
    stdoutIncludes: ['curl '],
    stderrIncludes: [],
  },
  {
    id: 'tar-exe',
    command: '& tar.exe --version; exit $LASTEXITCODE',
    expectedExitCode: 0,
    stdoutIncludes: ['bsdtar '],
    stderrIncludes: [],
  },
  {
    id: 'cmd-shim',
    command: '& host-cli-cmd "参数 中文 空格" "错误 中文 空格"; exit $LASTEXITCODE',
    expectedExitCode: 0,
    stdoutIncludes: ['CMD_STDOUT:参数 中文 空格'],
    stderrIncludes: ['CMD_STDERR:错误 中文 空格'],
  },
  {
    id: 'bat-shim',
    command: '& host-cli-bat "参数 中文 非零" "错误 中文 非零"; exit $LASTEXITCODE',
    expectedExitCode: 37,
    stdoutIncludes: ['BAT_STDOUT:参数 中文 非零'],
    stderrIncludes: ['BAT_STDERR:错误 中文 非零'],
  },
  {
    id: 'missing',
    command: `& ${MISSING_COMMAND}`,
    expectedExitCode: 1,
    stdoutIncludes: [],
    stderrIncludes: [MISSING_COMMAND],
  },
  {
    id: 'python-store-alias',
    command: [
      '$alias = Get-Command python.exe -CommandType Application -ErrorAction Stop',
      '$item = Get-Item -LiteralPath $alias.Path -ErrorAction Stop',
      '$packages = @(Get-AppxPackage -Name "*Python*" -ErrorAction Stop)',
      'if ($alias.Path -notlike "*\\Microsoft\\WindowsApps\\python.exe") { exit 71 }',
      'if ($item.Length -ne 0) { exit 72 }',
      'if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { exit 73 }',
      'if ($packages.Count -ne 0) { exit 74 }',
      '[Console]::Out.WriteLine("PYTHON_ALIAS_DISCOVERED_NOT_EXECUTED")',
      '[Console]::Out.WriteLine("PYTHON_ALIAS_ZERO_BYTE_REPARSE")',
      '[Console]::Out.WriteLine("PYTHON_PACKAGE_COUNT:0")',
      'exit 0',
    ].join('; '),
    expectedExitCode: 0,
    stdoutIncludes: [
      'PYTHON_ALIAS_DISCOVERED_NOT_EXECUTED',
      'PYTHON_ALIAS_ZERO_BYTE_REPARSE',
      'PYTHON_PACKAGE_COUNT:0',
    ],
    stderrIncludes: [],
  },
]);

const permissionSettings = {
  schema_version: 1 as const,
  kind: 'command_permission_settings' as const,
  revision: 1,
  permission_level: 'standard' as const,
  internal_data_access: 'allowed' as const,
  gui_control: 'denied' as const,
  local_ipc_control: 'denied' as const,
  process_lifecycle: 'terminate_with_run' as const,
};

function commandPermission() {
  return {
    status: 'available' as const,
    snapshot: createCommandRunPermissionSnapshot({
      settings: permissionSettings,
      rootAgentRunId: AGENT_RUN_ID,
      capturedAtMs: Date.now(),
    }),
  };
}

async function listManifestPaths(root: string): Promise<string[]> {
  const manifests: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.name === 'manifest.json') manifests.push(candidate);
    }
  }
  await visit(root);
  return manifests;
}

async function readRawOutput(input: {
  readonly artifactRoot: string;
  readonly originToolCallId: string;
}): Promise<{ stdout: string; stderr: string }> {
  const matches = [];
  for (const manifestPath of await listManifestPaths(input.artifactRoot)) {
    const parsed: unknown = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    const manifest = parseCommandOutputArtifactManifest(parsed);
    if (
      manifest.owner.identity.conversation_id === CONVERSATION_ID
      && manifest.owner.identity.agent_run_id === AGENT_RUN_ID
      && manifest.owner.identity.origin_tool_call_id === input.originToolCallId
    ) matches.push(manifestPath);
  }
  assert.equal(matches.length, 1, `expected one raw artifact for ${input.originToolCallId}`);
  const [manifestPath] = matches;
  assert(manifestPath);
  const directory = path.dirname(manifestPath);
  const [stdout, stderr] = await Promise.all([
    fsp.readFile(path.join(directory, 'stdout.bin'), 'utf8'),
    fsp.readFile(path.join(directory, 'stderr.bin'), 'utf8'),
  ]);
  return { stdout, stderr };
}

export async function runWindowsCurrentHostCliCorpusScenario(input: {
  readonly runRoot: string;
  readonly commandHostProcessEnvironment: HostProcessEnvironment;
}): Promise<Record<string, unknown>> {
  if (process.platform !== 'win32') {
    throw new Error('Windows current-host CLI corpus must run on Windows');
  }

  const appDataRoot = path.join(input.runRoot, 'app data 中文');
  const artifactRoot = path.join(appDataRoot, 'ConversationArtifacts', 'v1');
  await fsp.mkdir(appDataRoot, { recursive: true });
  const databaseService = new DatabaseService(path.join(input.runRoot, 'workspace.sqlite'));
  databaseService.initialize({ lifecycleBootstrap: bootstrapBuiltinPluginLifecycle });
  const db = databaseService.getDb();
  const eventStore = new SQLiteEventStore(db);
  const lifecycle = createConversationRouteLifecycle({ db, eventStore, storageRoot: appDataRoot });
  const audit = createCollectingCommandExecutionAuditPort();
  const environment = input.commandHostProcessEnvironment;
  const commandScope = createElectronCommandProductionScope({
    db,
    conversationAdmission: lifecycle.workDirectoryAdmission,
    approvalHost: createCommandApprovalHost(),
    commandExecutionAudit: audit,
    runtimeFacts: resolveCommandRuntimeFacts({
      platform: process.platform,
      environment: environment.entries,
      revision: ENVIRONMENT_REVISION,
      platformRuntime: resolveElectronLocalProcessPlatformRuntime({
        platform: process.platform,
        architecture: process.arch,
        applicationVersion: app.getVersion(),
        applicationExecutablePath: process.execPath,
        resourcesPath: process.resourcesPath,
        // 本 corpus 使用 unsigned packaged Electron，native manifest 仍走明确的开发信任。
        packaged: false,
        hostEnvironment: environment.entries,
      }),
    }),
    helperEnvironment: {},
    runnerPath: path.join(__dirname, 'commands', 'commandRunnerUtilityProcess.cjs'),
    artifactStorageRoot: artifactRoot,
    resolveToolOutputBlobsDirectory: ({ conversationId, instanceId }) => (
      path.join(appDataRoot, 'ToolOutputBlobs', conversationId, instanceId)
    ),
  });

  try {
    await eventStore.ensureConversation(CONVERSATION_ID, [], undefined, 'agent');
    const directory = await lifecycle.workDirectoryAdmission.withAdmission(
      { conversationId: CONVERSATION_ID }, admitted => admitted,
    );
    assert(directory.absolutePath.includes(' '));
    assert(directory.absolutePath.includes('中文'));
    const pathEntry = Object.entries(environment.entries).find(
      ([name]) => name.toLowerCase() === 'path',
    )?.[1];
    assert(pathEntry?.toLowerCase().includes('host-cli-fixtures'));
    assert.equal(environment.entries.PATHEXT, '.COM;.EXE;.BAT;.CMD');

    const results = [];
    for (const corpusCase of CORPUS) {
      const originToolCallId = CommandOriginToolCallIdSchema.parse(
        `call-windows-host-cli-${corpusCase.id}`,
      );
      const result = await commandScope.shellToolRuntime.executeShell({
        arguments: { command: corpusCase.command, initial_wait_ms: 30_000 },
        conversationId: CONVERSATION_ID,
        agentRunId: AGENT_RUN_ID,
        originToolCallId,
        toolOutputInstanceId: 'default',
        commandRunPermission: commandPermission(),
      });
      assert.equal(result.status, 'completed', `${corpusCase.id} must complete`);
      if (result.status !== 'completed') throw new Error(`${corpusCase.id} did not complete`);
      assert.equal(result.terminal.outcome, 'exited', corpusCase.id);
      if (result.terminal.outcome !== 'exited') throw new Error(`${corpusCase.id} did not exit`);
      assert.equal(result.terminal.exitCode, corpusCase.expectedExitCode, corpusCase.id);
      const raw = await readRawOutput({ artifactRoot, originToolCallId });
      for (const expected of corpusCase.stdoutIncludes) {
        assert(raw.stdout.includes(expected), `${corpusCase.id} stdout missing ${expected}`);
        assert(result.observation.includes(expected), `${corpusCase.id} observation missing ${expected}`);
      }
      for (const expected of corpusCase.stderrIncludes) {
        assert(raw.stderr.includes(expected), `${corpusCase.id} stderr missing ${expected}`);
        assert(result.observation.includes(expected), `${corpusCase.id} observation missing ${expected}`);
      }
      if (corpusCase.id === 'powershell') {
        assert(raw.stdout.includes(`PS_CWD:${directory.absolutePath}`));
      }
      results.push({
        id: corpusCase.id,
        exitCode: result.terminal.exitCode,
        stdoutBytes: Buffer.byteLength(raw.stdout),
        stderrBytes: Buffer.byteLength(raw.stderr),
      });
    }

    assert.equal(audit.read().filter(event => event.kind === 'execution_started').length, CORPUS.length);
    assert.equal(audit.read().filter(event => event.kind === 'execution_terminal').length, CORPUS.length);
    const agentRunEndBarrier = await commandScope.agentRunLifecycle.endAgentRun({
      conversationId: CONVERSATION_ID,
      agentRunId: AGENT_RUN_ID,
    });
    agentRunEndBarrier.release();
    return {
      success: true,
      version: 1,
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron,
      shell: 'powershell-5.1',
      environmentRevision: ENVIRONMENT_REVISION,
      packagedElectronDevelopmentTrust: true,
      windowsNativeJobRuntimeConfigured: true,
      pythonAliasExecuted: false,
      cases: results,
    };
  } finally {
    await commandScope.endOwnerAndWait();
    databaseService.close();
  }
}
