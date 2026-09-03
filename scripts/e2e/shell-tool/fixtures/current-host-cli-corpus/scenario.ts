import assert from 'node:assert/strict';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { app } from 'electron';
import { resolveElectronLocalProcessPlatformRuntime } from '../../../../../src/electron-main/local-process-runtime/production-runtime';
import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandOriginToolCallIdSchema,
  SHELL_COMMAND_MAX_LENGTH,
  countShellCommandCharacters,
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
import {
  createHostProcessEnvironment,
  createMacOsShellEnvironmentSnapshot,
} from '../../../../../src/infra/adapters/command-runtime/environment';
import { createCollectingCommandExecutionAuditPort } from '../../functions/createCollectingCommandExecutionAuditPort';

interface CorpusCase {
  readonly id: string;
  readonly command: string;
  readonly expectedExitCode: number;
  readonly stdoutIncludes: readonly string[];
  readonly stderrIncludes: readonly string[];
}

const CONVERSATION_ID = CommandConversationIdSchema.parse('conversation-current-host-cli-corpus');
const AGENT_RUN_ID = CommandAgentRunIdSchema.parse('agent-run-current-host-cli-corpus');
const UNICODE_ARGUMENT = '参数 空格-中文';
const MINIMAL_HOST_PATH = '/bin:/usr/sbin:/sbin';
const ENVIRONMENT_REVISION = 'current-host-cli-corpus-v2';
const PC52_BOUNDARY_MARKER = 'PC52_BOUNDARY_OK';

const CORPUS: readonly CorpusCase[] = Object.freeze([
  {
    id: 'zsh',
    command: `zsh corpus-fixtures/zsh-case.zsh '${UNICODE_ARGUMENT}'`,
    expectedExitCode: 23,
    stdoutIncludes: [`ZSH_STDOUT_中文:${UNICODE_ARGUMENT}`],
    stderrIncludes: ['ZSH_STDERR_中文'],
  },
  {
    id: 'python3',
    command: `python3 corpus-fixtures/python-case.py '${UNICODE_ARGUMENT}'`,
    expectedExitCode: 31,
    stdoutIncludes: [`PY_STDOUT_中文:${UNICODE_ARGUMENT}`, 'PY_CWD:', 'PY_LIBS:OpenSSL'],
    stderrIncludes: ['PY_STDERR_中文'],
  },
  {
    id: 'node',
    command: `node corpus-fixtures/node-case.cjs '${UNICODE_ARGUMENT}'`,
    expectedExitCode: 41,
    stdoutIncludes: [`NODE_STDOUT_中文:${UNICODE_ARGUMENT}`],
    stderrIncludes: ['NODE_STDERR_中文'],
  },
  {
    id: 'git',
    command: "git init --quiet git-case && git -C git-case status --short && printf 'GIT_STATUS_EMPTY\\n'",
    expectedExitCode: 0,
    stdoutIncludes: ['GIT_STATUS_EMPTY'],
    stderrIncludes: [],
  },
  {
    id: 'hermes',
    command: 'hermes --version',
    expectedExitCode: 0,
    stdoutIncludes: ['Hermes Agent v'],
    stderrIncludes: [],
  },
  {
    id: 'ffmpeg-missing',
    command: 'ffmpeg --version',
    expectedExitCode: 127,
    stdoutIncludes: [],
    stderrIncludes: ['command not found: ffmpeg'],
  },
  {
    id: 'pandoc-missing',
    command: 'pandoc --version',
    expectedExitCode: 127,
    stdoutIncludes: [],
    stderrIncludes: ['command not found: pandoc'],
  },
]);

const FIXTURE_FILES = Object.freeze({
  'zsh-case.zsh': [
    'builtin printf \'ZSH_STDOUT_中文:%s\\n\' "$1"',
    'builtin printf \'ZSH_STDERR_中文\\n\' >&2',
    'exit 23',
    '',
  ].join('\n'),
  'python-case.py': [
    'import ctypes',
    'import multiprocessing',
    'import os',
    'import sqlite3',
    'import ssl',
    'import sys',
    'print("PY_STDOUT_中文:" + sys.argv[1])',
    'print("PY_CWD:" + os.getcwd())',
    'print("PY_LIBS:" + ssl.OPENSSL_VERSION + ":" + sqlite3.sqlite_version + ":" + multiprocessing.get_start_method())',
    'print("PY_STDERR_中文", file=sys.stderr)',
    'sys.exit(31)',
    '',
  ].join('\n'),
  'node-case.cjs': [
    'console.log("NODE_STDOUT_中文:" + process.argv[2]);',
    'console.error("NODE_STDERR_中文");',
    'process.exit(41);',
    '',
  ].join('\n'),
});

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
    ) {
      matches.push(manifestPath);
    }
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

async function resolveFromPath(command: string, pathValue: string): Promise<string | undefined> {
  for (const directory of pathValue.split(path.delimiter)) {
    const candidate = path.join(directory, command);
    try {
      await fsp.access(candidate, fsConstants.X_OK);
      return candidate;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  return undefined;
}

async function writeCorpusFixtures(conversationDirectory: string): Promise<void> {
  const fixtureRoot = path.join(conversationDirectory, 'corpus-fixtures');
  await fsp.mkdir(fixtureRoot);
  await Promise.all(Object.entries(FIXTURE_FILES).map(([name, body]) => (
    fsp.writeFile(path.join(fixtureRoot, name), body, 'utf8')
  )));
}

function createPc52BoundaryCommand(): string {
  const prefix = `printf '${PC52_BOUNDARY_MARKER}\\n'\n# `;
  const remaining = SHELL_COMMAND_MAX_LENGTH - countShellCommandCharacters(prefix);
  const characterCorpus = Array.from(`ASCII中文😀"'\\ `);
  const comment = Array.from({ length: remaining }, (_, index) => (
    characterCorpus[index % characterCorpus.length]
  )).join('');
  const command = `${prefix}${comment}`;
  assert.equal(countShellCommandCharacters(command), SHELL_COMMAND_MAX_LENGTH);
  return command;
}

export async function runCurrentHostCliCorpusScenario(input: {
  readonly runRoot: string;
}): Promise<Record<string, unknown>> {
  if (process.platform !== 'darwin') {
    throw new Error('current-host CLI production corpus currently targets macOS');
  }

  const appDataRoot = path.join(input.runRoot, 'app data 中文');
  const artifactRoot = path.join(appDataRoot, 'ConversationArtifacts', 'v1');
  await fsp.mkdir(appDataRoot, { recursive: true });
  const databaseService = new DatabaseService(path.join(input.runRoot, 'workspace.sqlite'));
  databaseService.initialize({ lifecycleBootstrap: bootstrapBuiltinPluginLifecycle });
  const db = databaseService.getDb();
  const eventStore = new SQLiteEventStore(db);
  const lifecycle = createConversationRouteLifecycle({
    db,
    eventStore,
    storageRoot: appDataRoot,
  });
  const audit = createCollectingCommandExecutionAuditPort();
  const host = createHostProcessEnvironment({
    HOME: process.env.HOME,
    USER: process.env.USER,
    LOGNAME: process.env.LOGNAME,
    TMPDIR: process.env.TMPDIR,
    LANG: process.env.LANG,
    PATH: MINIMAL_HOST_PATH,
  });
  for (const command of ['python3', 'node', 'git', 'hermes']) {
    assert.equal(
      await resolveFromPath(command, MINIMAL_HOST_PATH),
      undefined,
      `minimal host PATH unexpectedly resolves ${command}`,
    );
  }
  const environmentResolution = await createMacOsShellEnvironmentSnapshot({
    host,
    revision: ENVIRONMENT_REVISION,
  });
  assert.equal(environmentResolution.probe.status, 'succeeded');
  assert.equal(environmentResolution.snapshot.source, 'macos_login_shell');
  for (const command of ['python3', 'node', 'git', 'hermes']) {
    assert(
      await resolveFromPath(command, environmentResolution.snapshot.entries.PATH ?? ''),
      `login environment did not restore ${command}`,
    );
  }
  const commandScope = createElectronCommandProductionScope({
    db,
    conversationAdmission: lifecycle.workDirectoryAdmission,
    approvalHost: createCommandApprovalHost(),
    commandExecutionAudit: audit,
    runtimeFacts: resolveCommandRuntimeFacts({
      platform: process.platform,
      environment: environmentResolution.snapshot.entries,
      revision: ENVIRONMENT_REVISION,
      platformRuntime: resolveElectronLocalProcessPlatformRuntime({
        platform: process.platform,
        architecture: process.arch,
        applicationVersion: app.getVersion(),
        applicationExecutablePath: process.execPath,
        resourcesPath: process.resourcesPath,
        packaged: false,
        hostEnvironment: environmentResolution.snapshot.entries,
      }),
    }),
    // Utility helper 与正式 routes 保持最小环境；用户登录快照只属于被执行的 Shell。
    helperEnvironment: Object.freeze({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }),
    runnerPath: path.join(input.runRoot, 'runner', 'commandRunnerUtilityProcess.cjs'),
    artifactStorageRoot: artifactRoot,
    resolveToolOutputBlobsDirectory: ({ conversationId, instanceId }) => (
      path.join(appDataRoot, 'ToolOutputBlobs', conversationId, instanceId)
    ),
  });

  try {
    await eventStore.ensureConversation(CONVERSATION_ID, [], undefined, 'agent');
    const directory = await lifecycle.workDirectoryAdmission.withAdmission(
      { conversationId: CONVERSATION_ID },
      admitted => admitted,
    );
    assert(directory.absolutePath.includes(' '), 'corpus cwd must contain a space');
    assert(directory.absolutePath.includes('中文'), 'corpus cwd must contain Unicode');
    await writeCorpusFixtures(directory.absolutePath);

    const results = [];
    for (const corpusCase of CORPUS) {
      const originToolCallId = CommandOriginToolCallIdSchema.parse(
        `call-host-cli-${corpusCase.id}`,
      );
      const result = await commandScope.shellToolRuntime.executeShell({
        arguments: { command: corpusCase.command, initial_wait_ms: 30_000 },
        conversationId: CONVERSATION_ID,
        agentRunId: AGENT_RUN_ID,
        originToolCallId,
        toolOutputInstanceId: 'default',
        commandRunPermission: commandPermission(),
      });
      assert.equal(result.status, 'completed', `${corpusCase.id} must finish in initial wait`);
      if (result.status !== 'completed') throw new Error(`${corpusCase.id} did not complete`);
      assert.equal(result.terminal.outcome, 'exited', `${corpusCase.id} must preserve shell exit`);
      if (result.terminal.outcome !== 'exited') throw new Error(`${corpusCase.id} did not exit`);
      assert.equal(result.terminal.exitCode, corpusCase.expectedExitCode, corpusCase.id);

      const raw = await readRawOutput({ artifactRoot, originToolCallId });
      for (const expected of corpusCase.stdoutIncludes) {
        assert(raw.stdout.includes(expected), `${corpusCase.id} stdout missing ${expected}`);
        assert(
          result.observation.includes(expected),
          `${corpusCase.id} observation missing ${expected}`,
        );
      }
      for (const expected of corpusCase.stderrIncludes) {
        assert(raw.stderr.includes(expected), `${corpusCase.id} stderr missing ${expected}`);
        assert(
          result.observation.includes(expected),
          `${corpusCase.id} observation missing ${expected}`,
        );
      }
      if (corpusCase.id === 'python3') {
        assert(raw.stdout.includes(`PY_CWD:${directory.absolutePath}`));
      }
      results.push({
        id: corpusCase.id,
        command: corpusCase.command,
        exitCode: result.terminal.exitCode,
        stdoutBytes: Buffer.byteLength(raw.stdout),
        stderrBytes: Buffer.byteLength(raw.stderr),
      });
    }

    const pc52BoundaryCommand = createPc52BoundaryCommand();
    const pc52BoundaryToolCallId = CommandOriginToolCallIdSchema.parse(
      'call-host-cli-pc52-boundary',
    );
    const pc52BoundaryResult = await commandScope.shellToolRuntime.executeShell({
      arguments: { command: pc52BoundaryCommand, initial_wait_ms: 30_000 },
      conversationId: CONVERSATION_ID,
      agentRunId: AGENT_RUN_ID,
      originToolCallId: pc52BoundaryToolCallId,
      toolOutputInstanceId: 'default',
      commandRunPermission: commandPermission(),
    });
    assert.equal(pc52BoundaryResult.status, 'completed');
    if (pc52BoundaryResult.status !== 'completed') {
      throw new Error('PC-52 boundary command did not complete');
    }
    assert.deepEqual(pc52BoundaryResult.terminal, {
      outcome: 'exited',
      exitCode: 0,
      signal: null,
    });
    assert(pc52BoundaryResult.observation.includes(PC52_BOUNDARY_MARKER));
    const pc52BoundaryRaw = await readRawOutput({
      artifactRoot,
      originToolCallId: pc52BoundaryToolCallId,
    });
    assert(pc52BoundaryRaw.stdout.includes(PC52_BOUNDARY_MARKER));
    assert.equal(pc52BoundaryRaw.stderr, '');

    const auditsBeforeInvalidInput = audit.read().length;
    const artifactsBeforeInvalidInput = (await listManifestPaths(artifactRoot)).length;
    for (const [id, command] of [
      ['nul', `printf 'before\0after'`],
      ['over-limit', 'a'.repeat(SHELL_COMMAND_MAX_LENGTH + 1)],
    ] as const) {
      const rejected = await commandScope.shellToolRuntime.executeShell({
        arguments: { command },
        conversationId: CONVERSATION_ID,
        agentRunId: AGENT_RUN_ID,
        originToolCallId: CommandOriginToolCallIdSchema.parse(`call-host-cli-pc52-${id}`),
        toolOutputInstanceId: 'default',
        commandRunPermission: commandPermission(),
      });
      assert.deepEqual(rejected, {
        status: 'rejected',
        code: 'invalid_arguments',
        observation: 'Invalid shell arguments.',
      });
    }
    assert.equal(audit.read().length, auditsBeforeInvalidInput);
    assert.equal((await listManifestPaths(artifactRoot)).length, artifactsBeforeInvalidInput);

    assert.equal(
      audit.read().filter(event => event.kind === 'execution_started').length,
      CORPUS.length + 1,
    );
    assert.equal(
      audit.read().filter(event => event.kind === 'execution_terminal').length,
      CORPUS.length + 1,
    );
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
      shell: 'zsh',
      environmentRevision: ENVIRONMENT_REVISION,
      environmentProbe: {
        status: environmentResolution.probe.status,
        source: environmentResolution.snapshot.source,
        variableCount: environmentResolution.probe.status === 'succeeded'
          ? environmentResolution.probe.variableCount
          : 0,
      },
      utilityAndSrt: true,
      pc52InputBoundary: {
        acceptedCharacters: countShellCommandCharacters(pc52BoundaryCommand),
        acceptedExitCode: pc52BoundaryResult.terminal.exitCode,
        invalidCasesRejectedBeforeAudit: 2,
        publicRejectionCode: 'invalid_arguments',
      },
      cases: results,
    };
  } finally {
    await commandScope.endOwnerAndWait();
    databaseService.close();
  }
}
