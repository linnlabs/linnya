import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CommandAgentRunIdSchema,
  CommandConversationIdSchema,
  CommandLaunchEnvironmentV1Schema,
  CommandOriginToolCallIdSchema,
  CommandResolvedShellV1Schema,
  parseCommandExecutionTerminal,
  parseCommandRunnerEvent,
  type CommandExecutionIdentity,
  type CommandRunnerRequestV1,
} from '@app/schemas/commands';

import {
  ConversationWorkDirectoryConversationIdSchema,
  ConversationWorkDirectoryDigestSchema,
  ConversationWorkDirectoryKeySchema,
} from '../../../../domains/conversation-files';
import type {
  CommandRunnerProcessHandlers,
  CommandRunnerProcessPort,
} from '../../../../domains/commands';
import { createCommandRunPermissionSnapshot } from '../../../../domains/commands/features/permission-settings';
import { ToolOutputBlobManifestSchema } from '../../../../tools/tool_output';
import type { ConversationWorkDirectoryAdmissionPort } from '../../../../app-hosts/linnya/application/conversation-lifecycle';
import type { CommandExecutionAuditEvent } from '../../../../domains/audit/features/command-execution-audit';
import { formatShellToolModelObservation } from '../../../../domains/commands';
import { COMMAND_APPROVAL_SCHEMAS } from '../../../../app-hosts/linnya/adapters/persistence/command-approvals';
import { COMMAND_CARD_SETTLEMENT_SCHEMAS } from '../../../../app-hosts/linnya/adapters/persistence/command-card-settlements';
import { createCommandApprovalHost } from 'src/app-hosts/linnya/adapters/commands/approval-host';
import { createElectronCommandProductionScope } from './createElectronCommandProductionScope';

const roots: string[] = [];
const databases: Database.Database[] = [];

afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map(root => fsp.rm(root, {
    recursive: true,
    force: true,
  })));
});

async function createRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-production-command-scope-'));
  roots.push(root);
  return root;
}

function createDatabase(conversationId: string): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE conversations (conversation_id TEXT PRIMARY KEY)');
  for (const schema of COMMAND_APPROVAL_SCHEMAS) db.exec(schema);
  for (const schema of COMMAND_CARD_SETTLEMENT_SCHEMAS) db.exec(schema);
  db.prepare('INSERT INTO conversations (conversation_id) VALUES (?)').run(conversationId);
  return db;
}

function createAdmission(input: {
  readonly conversationId: string;
  readonly conversationRoot: string;
}): ConversationWorkDirectoryAdmissionPort {
  return {
    async withAdmission(_request, admitted) {
      return admitted({
        identity: {
          kind: 'linnya_conversation_work_directory',
          revision: 1,
          conversationId: ConversationWorkDirectoryConversationIdSchema.parse(
            input.conversationId,
          ),
          conversationIdDigest: ConversationWorkDirectoryDigestSchema.parse('a'.repeat(64)),
          directoryKey: ConversationWorkDirectoryKeySchema.parse(
            `conversation_${'a'.repeat(64)}`,
          ),
        },
        absolutePath: input.conversationRoot,
        status: 'existing',
      });
    },
  };
}

function terminalEvent(input: {
  readonly identity: CommandExecutionIdentity;
  readonly cause: 'natural_exit' | 'owner_ended';
  readonly stdoutBytes: number;
}) {
  return parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_terminal',
    terminal: parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity: input.identity,
      settled_at_ms: Date.now(),
      outcome: 'execution_ended',
      termination_cause: input.cause,
      process_exit: {
        status: 'observed',
        exit_code: input.cause === 'natural_exit' ? 0 : null,
        signal: input.cause === 'natural_exit' ? null : 'SIGTERM',
      },
      output_drain: { status: 'complete' },
      tree_cleanup: input.cause === 'natural_exit'
        ? { status: 'not_required' }
        : { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    }),
    output_sources: {
      mode: 'pipe',
      stdout: {
        source_completion: 'complete',
        next_sequence: input.stdoutBytes > 0 ? 1 : 0,
        observed_bytes: input.stdoutBytes,
      },
      stderr: {
        source_completion: 'complete',
        next_sequence: 0,
        observed_bytes: 0,
      },
    },
  });
}

function createRunner(): {
  readonly port: CommandRunnerProcessPort;
  readonly requests: CommandRunnerRequestV1[];
} {
  const requests: CommandRunnerRequestV1[] = [];
  const port: CommandRunnerProcessPort = {
    fork(handlers: CommandRunnerProcessHandlers) {
      let launchIdentity: CommandExecutionIdentity | undefined;
      let stdoutBytes = 0;
      return {
        async send(request) {
          requests.push(request);
          if (request.kind === 'command_runner_start') {
            launchIdentity = request.launch.proposal.identity;
            const output = Buffer.from(
              request.launch.proposal.command === 'emit bounded-large-output'
                ? Array.from({ length: 5 }, () => 'x'.repeat(5_000)).join('\n')
                : `scope:${request.launch.proposal.command}\n`,
              'utf8'
            );
            stdoutBytes = output.byteLength;
            queueMicrotask(() => {
              handlers.onMessage(parseCommandRunnerEvent({
                protocol_version: 1,
                kind: 'command_runner_started',
                identity: request.launch.proposal.identity,
                started_at_ms: Date.now(),
              }));
              handlers.onMessage(parseCommandRunnerEvent({
                protocol_version: 1,
                kind: 'command_runner_output',
                identity: request.launch.proposal.identity,
                channel: 'stdout',
                sequence: 0,
                bytes: output,
              }));
              if (
                request.launch.proposal.command === 'printf production-scope'
                || request.launch.proposal.command === 'emit bounded-large-output'
              ) {
                handlers.onMessage(terminalEvent({
                  identity: request.launch.proposal.identity,
                  cause: 'natural_exit',
                  stdoutBytes,
                }));
                handlers.onClose();
              }
            });
            return;
          }
          if (request.kind === 'command_runner_stop') {
            const identity = launchIdentity;
            if (!identity) throw new Error('runner received stop before start');
            queueMicrotask(() => {
              handlers.onMessage(terminalEvent({
                identity,
                cause: 'owner_ended',
                stdoutBytes,
              }));
              handlers.onClose();
            });
          }
        },
        disconnect() {},
        kill() {},
      };
    },
  };
  return { port, requests };
}

async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else found.push(filePath);
    }
  }
  await visit(root);
  return found;
}

describe('createElectronCommandProductionScope', () => {
  it('从生产 scope 贯穿真实 artifact/text，并按 Agent run 与 App owner 收口', async () => {
    const root = await createRoot();
    const conversationRoot = path.join(root, 'conversation');
    const artifactRoot = path.join(root, 'artifacts');
    const textRoot = path.join(root, 'tool-output');
    await fsp.mkdir(conversationRoot, { recursive: true });
    const conversationId = CommandConversationIdSchema.parse('conversation-production-scope');
    const approvalHost = createCommandApprovalHost();
    const runner = createRunner();
    const auditEvents: CommandExecutionAuditEvent[] = [];
    const toolOutputScopes: Array<{ conversationId: string; instanceId: string }> = [];
    let releaseBackgroundTerminalAudit: () => void = () => undefined;
    const backgroundTerminalAuditBarrier = new Promise<void>((resolve) => {
      releaseBackgroundTerminalAudit = resolve;
    });
    const scope = await createElectronCommandProductionScope({
      db: createDatabase(conversationId),
      conversationAdmission: createAdmission({ conversationId, conversationRoot }),
      approvalHost,
      commandExecutionAudit: {
        async record(event) {
          auditEvents.push(event);
          if (
            event.kind === 'execution_terminal'
            && event.terminal.identity.agent_run_id === 'agent-run-running'
          ) await backgroundTerminalAuditBarrier;
        },
      },
      runtimeFacts: {
        shell: CommandResolvedShellV1Schema.parse({
          platform: 'macos',
          shell_semantics_id: 'zsh',
          shell_version: '5.9',
          snapshot_revision: 'production-scope-test',
          output_text_encoding: 'utf-8',
          command_invocation_profile_id: 'plain-v1',
          executable_path: '/bin/zsh',
          argv_prefix: ['-f', '-c'],
        }),
        environment: CommandLaunchEnvironmentV1Schema.parse({
          revision: 'production-scope-test',
          entries: { PATH: '/usr/bin:/bin' },
        }),
        platformRuntime: { schema_version: 1, platform: 'darwin' },
      },
      helperEnvironment: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      runnerPath: '/unused/fake-runner.cjs',
      artifactStorageRoot: artifactRoot,
      resolveToolOutputBlobsDirectory: scope => {
        toolOutputScopes.push(scope);
        return textRoot;
      },
      resolvePluginCli: () => undefined,
      runnerProcess: runner.port,
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
    const permission = {
      status: 'available' as const,
      snapshot: createCommandRunPermissionSnapshot({
        settings: permissionSettings,
        rootAgentRunId: CommandAgentRunIdSchema.parse('agent-run-natural'),
        capturedAtMs: 100,
      }),
    };

    const completed = await scope.shellToolRuntime.executeShell({
      arguments: { command: 'printf production-scope', initial_wait_ms: 1_000 },
      conversationId,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-natural'),
      originToolCallId: CommandOriginToolCallIdSchema.parse('call-natural'),
      toolOutputInstanceId: 'default',
      commandRunPermission: permission,
    });

    expect(completed).toMatchObject({
      status: 'completed',
      terminal: { outcome: 'exited', exitCode: 0 },
    });
    expect(completed.observation).toContain('scope:printf production-scope');
    const naturalStart = runner.requests.find(request => (
      request.kind === 'command_runner_start'
      && request.launch.proposal.identity.agent_run_id === 'agent-run-natural'
    ));
    expect(naturalStart).toMatchObject({
      kind: 'command_runner_start',
      launch: { hard_timeout_ms: 180_000 },
    });
    const artifactFiles = await listFiles(artifactRoot);
    const stdoutPath = artifactFiles.find(filePath => filePath.endsWith('stdout.bin'));
    expect(stdoutPath).toBeDefined();
    if (!stdoutPath) throw new Error('raw stdout artifact was not published');
    await expect(fsp.readFile(stdoutPath, 'utf8'))
      .resolves.toBe('scope:printf production-scope\n');
    const textFiles = await listFiles(textRoot);
    const manifestPath = textFiles.find(filePath => filePath.endsWith('manifest.json'));
    expect(manifestPath).toBeDefined();
    if (!manifestPath) throw new Error('text manifest was not published');
    const manifest = ToolOutputBlobManifestSchema.parse(
      JSON.parse(await fsp.readFile(manifestPath, 'utf8'))
    );
    expect(manifest).toMatchObject({
      conversation_id: conversationId,
      instance_id: 'default',
      tool_name: 'shell_stdout',
    });
    const textBodyPath = textFiles.find(filePath => filePath.endsWith('body.utf16le'));
    expect(textBodyPath).toBeDefined();
    if (!textBodyPath) throw new Error('text body was not published');
    await expect(fsp.readFile(textBodyPath, 'utf16le'))
      .resolves.toBe('scope:printf production-scope\n');
    expect(toolOutputScopes).toContainEqual({ conversationId, instanceId: 'default' });
    expect(scope.hasExecutingCommands()).toBe(false);

    const largeOutput = await scope.shellToolRuntime.executeShell({
      arguments: { command: 'emit bounded-large-output', initial_wait_ms: 1_000 },
      conversationId,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-large-output'),
      originToolCallId: CommandOriginToolCallIdSchema.parse('call-large-output'),
      toolOutputInstanceId: 'default',
      commandRunPermission: {
        status: 'available',
        snapshot: createCommandRunPermissionSnapshot({
          settings: permissionSettings,
          rootAgentRunId: CommandAgentRunIdSchema.parse('agent-run-large-output'),
          capturedAtMs: 150,
        }),
      },
    });
    expect(largeOutput).toMatchObject({
      status: 'completed',
      command_output_store: {
        stdout: { status: 'published', persisted_characters: 25_004 },
      },
    });
    const largeObservation = formatShellToolModelObservation(largeOutput);
    expect(largeObservation.length).toBeLessThanOrEqual(20_000);
    expect(largeObservation.split('\n').length).toBeLessThanOrEqual(1_200);

    const runningPermission = {
      status: 'available' as const,
      snapshot: createCommandRunPermissionSnapshot({
        settings: permissionSettings,
        rootAgentRunId: CommandAgentRunIdSchema.parse('agent-run-running'),
        capturedAtMs: 200,
      }),
    };
    const running = await scope.shellToolRuntime.executeShell({
      // fake runner 故意让这条普通安全命令保持运行；无需借用会触发风险审批的 sleep。
      arguments: { command: 'printf delayed-scope', initial_wait_ms: 250 },
      conversationId,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-running'),
      originToolCallId: CommandOriginToolCallIdSchema.parse('call-running'),
      toolOutputInstanceId: 'default',
      commandRunPermission: runningPermission,
    });
    expect(running).toMatchObject({ status: 'running' });
    expect(scope.hasExecutingCommands()).toBe(true);

    const agentRunEndBarrier = await scope.agentRunLifecycle.endAgentRun({
      conversationId,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-running'),
    });
    expect(runner.requests.some(request => (
      request.kind === 'command_runner_stop'
      && request.identity.agent_run_id === 'agent-run-running'
      && request.cause === 'owner_ended'
    ))).toBe(true);
    expect(scope.hasExecutingCommands()).toBe(false);
    agentRunEndBarrier.release();

    const ending = scope.endOwnerAndWait();
    expect(scope.endOwnerAndWait()).toBe(ending);
    let ownerEnded = false;
    void ending.then(() => { ownerEnded = true; });
    await Promise.resolve();
    expect(ownerEnded).toBe(false);
    releaseBackgroundTerminalAudit();
    await ending;
    expect(auditEvents.filter(event => event.kind === 'execution_terminal')).toHaveLength(3);
    expect(approvalHost.openRendererPage(1)).toBeUndefined();
  });
});
