import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import {
  CommandAgentRunIdSchema,
  CommandApprovalReplyV1Schema,
  CommandApprovalReplySubmissionV1Schema,
  CommandControlToolCallIdSchema,
  CommandConversationIdSchema,
  CommandExecutionIdentitySchema,
  CommandLaunchEnvironmentV1Schema,
  CommandResolvedShellV1Schema,
  CommandRunPermissionSnapshotV1Schema,
  CommandOriginToolCallIdSchema,
  parseCommandExecutionTerminal,
  type CommandExecutionTerminalV1,
  type CommandExecutionOwnerBindingV1,
  type CommandLaunchSnapshotV1,
} from '@app/schemas/commands';
import type {
  CommandExecutionAuditEvent,
} from '../../../../../../domains/audit/features/command-execution-audit';
import {
  CLOSED_COMMAND_EXECUTION_INTERACTION,
  createUnavailableCommandSettledTextOutput,
  type CommandApprovalPort,
  type CommandApprovalResponse,
  type ConversationCommandApproval,
  type ConversationCommandApprovalPort,
  type PreparedCommandExecutionRuntime,
} from '../../../../../../domains/commands';
import {
  ConversationWorkDirectoryConversationIdSchema,
  ConversationWorkDirectoryDigestSchema,
  ConversationWorkDirectoryKeySchema,
} from '../../../../../../domains/conversation-files';
import {
  createBoundedPipeCommandOutputObservation,
} from '../../../../../../infra/adapters/command-runtime/output';
import type {
  ConversationWorkDirectoryAdmissionPort,
} from '../../../../application/conversation-lifecycle';
import { createLocalCommandExecutionOwner } from '../../process-owner';
import type { LocalCommandOwnerPort } from '../../process-owner';
import { createCommandApprovalHost } from 'src/app-hosts/linnya/adapters/commands/approval-host';
import type {
  ExecuteProcessToolRequest,
  ExecuteShellToolRequest,
  ShellCommandRuntimeBackend,
} from '../definitions';
import { createShellToolRuntime } from '../orchestration/createShellToolRuntime';

const NOW = 1_785_600_000_000;
const CONVERSATION_ID = CommandConversationIdSchema.parse('conversation-a');

const unavailableSettledTextOutput = () => Promise.resolve(
  createUnavailableCommandSettledTextOutput('pipe'),
);

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function terminal(
  launch: CommandLaunchSnapshotV1,
  cause: 'natural_exit' | 'user_cancelled' = 'natural_exit',
): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: launch.proposal.identity,
    settled_at_ms: NOW + 1,
    outcome: 'execution_ended',
    termination_cause: cause,
    process_exit: { status: 'observed', exit_code: cause === 'natural_exit' ? 0 : null, signal: cause === 'natural_exit' ? null : 'SIGTERM' },
    output_drain: { status: 'complete' },
    tree_cleanup: cause === 'natural_exit'
      ? { status: 'not_required' }
      : { status: 'succeeded' },
    resource_release: { status: 'succeeded' },
  });
}

function preparedRuntime(input: {
  readonly launch: CommandLaunchSnapshotV1;
  readonly immediate?: boolean;
  readonly failStart?: boolean;
  readonly failStop?: boolean;
  readonly lifecycle: string[];
}): PreparedCommandExecutionRuntime {
  const output = createBoundedPipeCommandOutputObservation({
    maxEvents: 32,
    maxCharacters: 2_000,
  });
  const completion = deferred<CommandExecutionTerminalV1>();
  let settled: CommandExecutionTerminalV1 | undefined;
  const settle = (candidate: CommandExecutionTerminalV1): CommandExecutionTerminalV1 => {
    if (settled) return settled;
    settled = candidate;
    output.close({ trailingStableText: { stdout: '', stderr: '' } });
    completion.resolve(candidate);
    return candidate;
  };
  const interaction = input.launch.mode === 'pipe'
    ? CLOSED_COMMAND_EXECUTION_INTERACTION
    : {
        kind: 'pty' as const,
        async write() { input.lifecycle.push('pty:write'); },
        async submit() { input.lifecycle.push('pty:submit'); },
        async eof() { input.lifecycle.push('pty:eof'); },
        async resize() { input.lifecycle.push('pty:resize'); },
      };
  return {
    interaction,
    outputObservation: output,
    settledTextOutput: unavailableSettledTextOutput(),
    terminal: completion.promise,
    async start() {
      input.lifecycle.push(`start:${input.launch.mode}`);
      output.accept({
        channel: 'stdout',
        stableText: `${input.launch.mode} output\n`,
        currentLogicalLines: {
          stdout: { text: '', omittedCharacters: 0 },
          stderr: { text: '', omittedCharacters: 0 },
        },
      });
      if (input.failStart) throw new Error('injected start handshake failure');
      if (input.immediate) {
        return {
          status: 'terminal',
          startedAtMs: 200,
          terminal: settle(terminal(input.launch)),
        };
      }
      return { status: 'running', startedAtMs: 200 };
    },
    async stopAndWait(cause) {
      input.lifecycle.push('stop');
      if (input.failStop) throw new Error('injected runtime cleanup failure');
      if (cause === 'runtime_start_failed') {
        return settle(parseCommandExecutionTerminal({
          protocol_version: 1,
          kind: 'command_execution_terminal',
          identity: input.launch.proposal.identity,
          settled_at_ms: NOW + 1,
          outcome: 'runtime_failure',
          failure: { code: 'launch_failed' },
          process_exit: { status: 'not_started' },
          output_drain: { status: 'not_started' },
          tree_cleanup: { status: 'not_required' },
          resource_release: { status: 'not_required' },
        }));
      }
      return settle(terminal(input.launch, 'user_cancelled'));
    },
  };
}

class MemoryApprovals implements ConversationCommandApprovalPort {
  readonly values: ConversationCommandApproval[] = [];
  readonly lifecycle: string[];
  readonly failRemember: boolean;
  readonly failRevoke: boolean;
  readonly listBarrier: Deferred<void> | undefined;

  constructor(input: {
    readonly lifecycle: string[];
    readonly failRemember?: boolean;
    readonly failRevoke?: boolean;
    readonly listBarrier?: Deferred<void>;
  }) {
    this.lifecycle = input.lifecycle;
    this.failRemember = input.failRemember ?? false;
    this.failRevoke = input.failRevoke ?? false;
    this.listBarrier = input.listBarrier;
  }

  async remember(value: ConversationCommandApproval) {
    this.lifecycle.push('approval:persisted');
    if (this.failRemember) throw new Error('persistence failed');
    this.values.push(value);
    return { status: 'created' as const, approval: value };
  }

  async listForConversation() {
    if (this.listBarrier) await this.listBarrier.promise;
    return [...this.values];
  }

  async revoke(approvalRequestId: ConversationCommandApproval['approvalRequestId']) {
    this.lifecycle.push('approval:revoked');
    if (this.failRevoke) throw new Error('injected approval revoke failure');
    const index = this.values.findIndex(value => value.approvalRequestId === approvalRequestId);
    if (index >= 0) this.values.splice(index, 1);
  }
}

function approvalPort(input: {
  readonly choice: 'allow_once' | 'allow_for_conversation' | 'deny';
  readonly lifecycle: string[];
  readonly onRequest?: () => void;
  readonly onSettle?: () => void;
  readonly invalidateWhenAborted?: boolean;
}): CommandApprovalPort {
  return {
    async request({ request, abortSignal }): Promise<CommandApprovalResponse> {
      input.lifecycle.push('approval:requested');
      input.onRequest?.();
      if (input.invalidateWhenAborted && abortSignal?.aborted) {
        return { status: 'invalidated', reason: 'run_cancelled' };
      }
      return {
        status: 'replied',
        reply: CommandApprovalReplyV1Schema.parse({
          protocol_version: 1,
          kind: 'command_approval_reply',
          approval_request_id: request.approval_request_id,
          choice: input.choice,
        }),
      };
    },
    async settle(settlement) {
      input.lifecycle.push(`approval:settled:${settlement.outcome}`);
      input.onSettle?.();
    },
  };
}

function runPermission(
  agentRunId = 'agent-run-a',
  permissionLevel: 'read_only' | 'standard' | 'full_access' = 'standard',
) {
  return {
    status: 'available' as const,
    snapshot: CommandRunPermissionSnapshotV1Schema.parse({
      protocol_version: 1,
      kind: 'command_run_permission_snapshot',
      root_agent_run_id: agentRunId,
      settings_revision: 1,
      captured_at_ms: NOW,
      permission_level: permissionLevel,
      internal_data_access: 'allowed',
      gui_control: 'denied',
      local_ipc_control: 'denied',
      process_lifecycle: 'terminate_with_run',
    }),
  };
}

function shellRequest(input: {
  readonly command: string;
  readonly interactive?: boolean;
  readonly initialWaitMs?: number;
  readonly hardTimeoutSeconds?: number;
  readonly requiresWriteAccess?: boolean;
  readonly permissionLevel?: 'read_only' | 'standard' | 'full_access';
  readonly runId?: string;
  readonly rootRunId?: string;
}): ExecuteShellToolRequest {
  const runId = input.runId ?? 'agent-run-a';
  return {
    arguments: {
      command: input.command,
      initial_wait_ms: input.initialWaitMs ?? 250,
      ...(input.interactive ? { interactive: true } : {}),
      ...(input.requiresWriteAccess ? { requires_write_access: true } : {}),
      ...(input.hardTimeoutSeconds === undefined
        ? {}
        : { hard_timeout_seconds: input.hardTimeoutSeconds }),
    },
    conversationId: CONVERSATION_ID,
    agentRunId: CommandAgentRunIdSchema.parse(runId),
    originToolCallId: CommandOriginToolCallIdSchema.parse('shell-call-a'),
    toolOutputInstanceId: 'default',
    commandRunPermission: runPermission(
      input.rootRunId ?? runId,
      input.permissionLevel,
    ),
  };
}

function fixture(input: {
  readonly approvalChoice?: 'allow_once' | 'allow_for_conversation' | 'deny';
  readonly immediate?: boolean;
  readonly failStart?: boolean;
  readonly failStop?: boolean;
  readonly failPrepare?: boolean;
  readonly mismatchRuntimeSnapshot?: boolean;
  readonly onApprovalRequest?: () => void;
  readonly failRemember?: boolean;
  readonly failRevoke?: boolean;
  readonly listBarrier?: Deferred<void>;
  readonly invalidateWhenAborted?: boolean;
  readonly onApprovalSettle?: () => void;
  readonly failFirstQuery?: boolean;
  readonly createUuid?: () => string;
  readonly approval?: CommandApprovalPort;
  readonly failAuditKinds?: ReadonlySet<CommandExecutionAuditEvent['kind']>;
  readonly onAuditRecord?: (event: CommandExecutionAuditEvent) => void;
  readonly ownerNow?: () => number;
} = {}) {
  const lifecycle: string[] = [];
  const approvals = new MemoryApprovals({
    lifecycle,
    failRemember: input.failRemember,
    failRevoke: input.failRevoke,
    listBarrier: input.listBarrier,
  });
  const baseOwner = createLocalCommandExecutionOwner({
    ...(input.ownerNow ? { now: input.ownerNow } : {}),
  });
  let failFirstQuery = input.failFirstQuery ?? false;
  const owner: LocalCommandOwnerPort = {
    ...baseOwner,
    async queryOutput(request) {
      if (failFirstQuery) {
        failFirstQuery = false;
        lifecycle.push('query:rejected');
        return { status: 'rejected', code: 'incompatible_state' };
      }
      return baseOwner.queryOutput(request);
    },
  };
  const launches: CommandLaunchSnapshotV1[] = [];
  const toolOutputInstanceIds: string[] = [];
  const auditEvents: CommandExecutionAuditEvent[] = [];
  const auditFailureBindings: CommandExecutionOwnerBindingV1[] = [];
  const auditFailureStages: string[] = [];
  const backend: ShellCommandRuntimeBackend = {
    owner,
    initialPtySize: { columns: 80, rows: 24 },
    readLaunchRuntimeContext() {
      return {
        shell: CommandResolvedShellV1Schema.parse({
          platform: 'macos',
          shell_semantics_id: 'zsh',
          shell_version: '5.9',
          snapshot_revision: 'startup-a',
          output_text_encoding: 'utf-8',
          command_invocation_profile_id: 'plain-v1',
          executable_path: '/bin/zsh',
          argv_prefix: ['-f', '-c'],
        }),
        environment: CommandLaunchEnvironmentV1Schema.parse({
          revision: input.mismatchRuntimeSnapshot ? 'startup-b' : 'startup-a',
          entries: { PATH: '/usr/bin:/bin' },
        }),
        defaultHardTimeoutMs: 180_000,
        maximumHardTimeoutMs: 600_000,
      };
    },
    preparePipe(launch, toolOutputScope) {
      lifecycle.push('prepare:pipe');
      if (input.failPrepare) throw new Error('injected runtime preparation failure');
      launches.push(launch);
      toolOutputInstanceIds.push(toolOutputScope.instanceId);
      return preparedRuntime({
        launch,
        immediate: input.immediate,
        failStart: input.failStart,
        failStop: input.failStop,
        lifecycle,
      });
    },
    preparePty(launch, toolOutputScope) {
      lifecycle.push('prepare:pty');
      if (input.failPrepare) throw new Error('injected runtime preparation failure');
      launches.push(launch);
      toolOutputInstanceIds.push(toolOutputScope.instanceId);
      return preparedRuntime({
        launch,
        immediate: input.immediate,
        failStart: input.failStart,
        failStop: input.failStop,
        lifecycle,
      });
    },
  };
  const conversationAdmission: ConversationWorkDirectoryAdmissionPort = {
    async withAdmission(_request, admitted) {
      lifecycle.push('admission');
      return admitted({
        identity: {
          kind: 'linnya_conversation_work_directory',
          revision: 1,
          conversationId: ConversationWorkDirectoryConversationIdSchema.parse(
            CONVERSATION_ID,
          ),
          conversationIdDigest: ConversationWorkDirectoryDigestSchema.parse('a'.repeat(64)),
          directoryKey: ConversationWorkDirectoryKeySchema.parse(
            `conversation_${'a'.repeat(64)}`,
          ),
        },
        absolutePath: '/tmp/linnya/conversation-a',
        status: 'existing',
      });
    },
  };
  const runtime = createShellToolRuntime({
    backend,
    conversationAdmission,
    workingDirectoryFileSystem: {
      async resolveDirectory(absolutePath) {
        return { status: 'resolved', canonicalPath: absolutePath };
      },
    },
    approvals,
    approval: input.approval ?? approvalPort({
      choice: input.approvalChoice ?? 'allow_once',
      lifecycle,
      onRequest: input.onApprovalRequest,
      onSettle: input.onApprovalSettle,
      invalidateWhenAborted: input.invalidateWhenAborted,
    }),
    audit: {
      async record(event) {
        if (input.failAuditKinds?.has(event.kind)) {
          throw new Error(`audit ${event.kind} unavailable`);
        }
        auditEvents.push(event);
        input.onAuditRecord?.(event);
      },
    },
    auditFailures: {
      report(binding) {
        if (!auditFailureBindings.some(
          current => current.process_handle === binding.process_handle,
        )) auditFailureBindings.push(binding);
      },
      hasFailure(binding) {
        return auditFailureBindings.some(
          current => current.process_handle === binding.process_handle,
        );
      },
    },
    auditDiagnostics: {
      recordFailure({ stage }) {
        auditFailureStages.push(stage);
      },
    },
    createUuid: input.createUuid ?? randomUUID,
    now: () => NOW,
  });
  return {
    runtime,
    owner,
    baseOwner,
    approvals,
    launches,
    toolOutputInstanceIds,
    lifecycle,
    auditEvents,
    auditFailureBindings,
    auditFailureStages,
  };
}

describe('ShellToolRuntime production orchestration', () => {
  it('把 ToolOutput 会话实例身份贯穿到 prepared runtime', async () => {
    const f = fixture({ immediate: true });

    await expect(f.runtime.executeShell({
      ...shellRequest({ command: 'printf tool-output-owner' }),
      toolOutputInstanceId: 'instance-shell-test',
    })).resolves.toMatchObject({ status: 'completed' });

    expect(f.toolOutputInstanceIds).toEqual(['instance-shell-test']);
  });

  it('只读档的显式写入申请只提升本条到 standard，并在审批前不启动', async () => {
    const f = fixture({ immediate: true, approvalChoice: 'allow_once' });
    const result = await f.runtime.executeShell(shellRequest({
      command: 'custom-image-cli --write output.png',
      permissionLevel: 'read_only',
      requiresWriteAccess: true,
    }));

    expect(result).toMatchObject({
      status: 'completed',
      presentation: {
        permission: {
          base_level: 'read_only',
          effective_level: 'standard',
          source: 'allow_once',
        },
      },
    });
    expect(f.lifecycle.slice(0, 3)).toEqual([
      'admission',
      'approval:requested',
      'approval:settled:approved',
    ]);
    expect(f.launches[0]?.permission).toMatchObject({
      base_level: 'read_only',
      effective_level: 'standard',
      grant_source: 'allow_once',
    });
  });

  it('只读档对明显写入补充审批，普通查询保持只读且不弹窗', async () => {
    const write = fixture({ immediate: true, approvalChoice: 'allow_once' });
    await expect(write.runtime.executeShell(shellRequest({
      command: 'touch result.txt',
      permissionLevel: 'read_only',
    }))).resolves.toMatchObject({
      status: 'completed',
      presentation: { permission: { effective_level: 'standard' } },
    });
    expect(write.lifecycle).toContain('approval:requested');

    const read = fixture({ immediate: true });
    await expect(read.runtime.executeShell(shellRequest({
      command: 'pwd',
      permissionLevel: 'read_only',
    }))).resolves.toMatchObject({
      status: 'completed',
      presentation: { permission: { effective_level: 'read_only' } },
    });
    expect(read.lifecycle).not.toContain('approval:requested');
  });

  it.each([
    ['默认值', undefined, 180_000],
    ['最小值', 1, 1_000],
    ['最大值', 600, 600_000],
  ] as const)('把 hard timeout %s冻结进 launch，且 initial wait 不改写总寿命', async (
    _case,
    hardTimeoutSeconds,
    expectedHardTimeoutMs,
  ) => {
    const f = fixture({ immediate: true });
    await expect(f.runtime.executeShell(shellRequest({
      command: 'printf timeout-contract',
      initialWaitMs: 30_000,
      ...(hardTimeoutSeconds === undefined ? {} : { hardTimeoutSeconds }),
    }))).resolves.toMatchObject({ status: 'completed' });
    expect(f.launches).toHaveLength(1);
    expect(f.launches[0]?.hard_timeout_ms).toBe(expectedHardTimeoutMs);
  });

  it.each([0, 601, 1.5])('拒绝越界 hard timeout %s，且不进入 admission 或启动', async (
    hardTimeoutSeconds,
  ) => {
    const f = fixture({ immediate: true });
    await expect(f.runtime.executeShell(shellRequest({
      command: 'printf invalid-timeout',
      hardTimeoutSeconds,
    }))).resolves.toMatchObject({ status: 'rejected', code: 'invalid_arguments' });
    expect(f.lifecycle).toEqual([]);
    expect(f.launches).toHaveLength(0);
  });

  it('App 四个 reservation 已满时投影稳定 capacity_unavailable，且不进入审批或启动', async () => {
    const f = fixture({ immediate: true });
    const ownerGenerationId = f.owner.readActivitySnapshot().generationId;
    const bindings = Array.from({ length: 4 }, (_, index) => {
      const reservation = f.owner.reserve({
        identity: CommandExecutionIdentitySchema.parse({
          conversation_id: CONVERSATION_ID,
          agent_run_id: 'capacity-existing-run',
          origin_tool_call_id: `capacity-existing-call-${index}`,
          command_execution_id: `command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4f0${index}`,
          owner_generation_id: ownerGenerationId,
          created_at_ms: NOW,
        }),
        mode: 'pipe',
      });
      if (reservation.status !== 'reserved') throw new Error('capacity fixture must reserve');
      return reservation.binding;
    });

    await expect(f.runtime.executeShell(shellRequest({ command: 'printf fifth' })))
      .resolves.toMatchObject({ status: 'rejected', code: 'capacity_unavailable' });
    expect(f.lifecycle).toEqual(['admission']);
    expect(f.launches).toHaveLength(0);
    for (const binding of bindings) f.owner.release(binding);
  });

  it('持久化对话批准后才 claim/start，并让超快终态不发布 handle', async () => {
    const f = fixture({ approvalChoice: 'allow_for_conversation', immediate: true });
    const result = await f.runtime.executeShell(shellRequest({ command: 'rm file.txt' }));

    expect(result).toMatchObject({
      status: 'completed',
      terminal: { outcome: 'exited', exitCode: 0 },
      presentation: {
        timing: { status: 'started', started_at_ms: 200 },
        permission: {
          base_level: 'standard',
          effective_level: 'standard',
          source: 'conversation_approval_created',
        },
      },
      observation: 'stdout:\npipe output',
    });
    expect(f.lifecycle).toEqual([
      'admission',
      'approval:requested',
      'approval:persisted',
      'approval:settled:approved',
      'prepare:pipe',
      'start:pipe',
    ]);
    expect(f.owner.readActivitySnapshot()).toMatchObject({
      runningCount: 0,
      terminalReplayCount: 0,
      pendingHandleDecisionCount: 0,
    });
    expect(f.auditEvents.map(event => event.kind)).toEqual([
      'proposal_created',
      'authorization_settled',
      'execution_started',
      'execution_terminal',
    ]);
    expect(f.auditEvents.find(event => event.kind === 'authorization_settled'))
      .toMatchObject({ approval_settlement: { outcome: 'approved', choice: 'allow_for_conversation' } });
  });

  it('拒绝审批时不准备 runtime、不 spawn，并释放 reservation', async () => {
    const f = fixture({ approvalChoice: 'deny' });
    const result = await f.runtime.executeShell(shellRequest({ command: 'rm file.txt' }));

    expect(result).toMatchObject({ status: 'rejected', code: 'approval_denied' });
    expect(f.lifecycle).toEqual([
      'admission',
      'approval:requested',
      'approval:settled:rejected',
    ]);
    expect(f.launches).toHaveLength(0);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
    expect(f.auditFailureStages).toEqual([]);
    expect(f.auditEvents.map(event => event.kind)).toEqual([
      'proposal_created',
      'authorization_settled',
    ]);
    expect(f.auditEvents[1]).toMatchObject({
      settlement: { outcome: 'rejected', code: 'approval_denied' },
      approval_settlement: { outcome: 'rejected' },
    });
  });

  it('proposal 审计失败时释放 reservation、零审批、零 spawn', async () => {
    const f = fixture({
      failAuditKinds: new Set<CommandExecutionAuditEvent['kind']>(['proposal_created']),
    });

    await expect(f.runtime.executeShell(shellRequest({ command: 'printf blocked' })))
      .resolves.toMatchObject({ status: 'rejected', code: 'audit_unavailable' });
    expect(f.lifecycle).toEqual(['admission']);
    expect(f.launches).toHaveLength(0);
    expect(f.auditFailureStages).toEqual(['proposal_created']);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('authorization 审计失败时撤销本次新批准，且绝不启动命令', async () => {
    const f = fixture({
      approvalChoice: 'allow_for_conversation',
      failAuditKinds: new Set<CommandExecutionAuditEvent['kind']>(['authorization_settled']),
    });

    await expect(f.runtime.executeShell(shellRequest({ command: 'rm file.txt' })))
      .resolves.toMatchObject({ status: 'rejected', code: 'audit_unavailable' });
    expect(f.lifecycle).toEqual([
      'admission',
      'approval:requested',
      'approval:persisted',
      'approval:settled:approved',
      'approval:revoked',
    ]);
    expect(f.approvals.values).toHaveLength(0);
    expect(f.launches).toHaveLength(0);
    expect(f.auditFailureStages).toEqual(['authorization_settled']);
  });

  it('命令启动后的审计失败不改写真实终态，并在稳定展示事实中标记不完整', async () => {
    const f = fixture({
      immediate: true,
      failAuditKinds: new Set<CommandExecutionAuditEvent['kind']>([
        'execution_started',
        'execution_terminal',
      ]),
    });

    await expect(f.runtime.executeShell(shellRequest({ command: 'printf completed' })))
      .resolves.toMatchObject({
        status: 'completed',
        terminal: { outcome: 'exited', exitCode: 0 },
        presentation: { audit_status: 'incomplete' },
      });
    expect(f.auditFailureBindings).toHaveLength(1);
    expect(f.auditFailureStages).toEqual(['execution_started', 'execution_terminal']);
    expect(f.owner.readActivitySnapshot()).toMatchObject({
      runningCount: 0,
      stoppingCount: 0,
    });
  });

  it('启动握手失败时由 owner 收口资源，并把可信终态写入审计', async () => {
    const f = fixture({ failStart: true });

    const result = await f.runtime.executeShell(shellRequest({ command: 'printf never-started' }));
    expect(result).toMatchObject({
      status: 'completed',
      terminal: { outcome: 'runtime_failure', code: 'launch_failed' },
      presentation: { audit_status: 'complete' },
    });
    expect(f.lifecycle).toEqual([
      'admission',
      'prepare:pipe',
      'start:pipe',
      'stop',
    ]);
    expect(f.auditEvents.map(event => event.kind)).toEqual([
      'proposal_created',
      'authorization_settled',
      'execution_terminal',
    ]);
    expect(f.auditEvents.find(event => event.kind === 'execution_terminal'))
      .toMatchObject({
        terminal: {
          outcome: 'runtime_failure',
          failure: { code: 'launch_failed' },
          process_exit: { status: 'not_started' },
        },
      });
    expect(f.owner.readActivitySnapshot()).toMatchObject({
      startingCount: 0,
      runningCount: 0,
      stoppingCount: 0,
    });
  });

  it('后续相同命令复用已持久化的对话批准，并保留来源差异', async () => {
    const f = fixture({ approvalChoice: 'allow_for_conversation', immediate: true });
    const first = await f.runtime.executeShell(shellRequest({ command: 'rm file.txt' }));
    const second = await f.runtime.executeShell(shellRequest({ command: 'rm file.txt' }));

    expect(first).toMatchObject({
      status: 'completed',
      presentation: { permission: { source: 'conversation_approval_created' } },
    });
    expect(second).toMatchObject({
      status: 'completed',
      presentation: { permission: { source: 'conversation_approval_reused' } },
    });
    expect(f.lifecycle.filter(event => event === 'approval:requested')).toHaveLength(1);
  });

  it('真实 Electron pending host 回复后由 Commands settlement 关闭卡片，再启动命令', async () => {
    const approval = createCommandApprovalHost({ createUuid: () => 'shell-page' });
    const page = approval.openRendererPage(71);
    if (!page) return;
    const f = fixture({ approval, immediate: true });
    const execution = f.runtime.executeShell(shellRequest({ command: 'rm file.txt' }));

    await expect.poll(() => (
      approval.readRendererPage({
        ownerId: 71,
        pageTicket: page.page_ticket,
      })?.pending.length
    )).toBe(1);
    const pending = approval.readRendererPage({
      ownerId: 71,
      pageTicket: page.page_ticket,
    })?.pending[0];
    if (!pending) return;
    expect(f.lifecycle).not.toContain('prepare:pipe');
    expect(approval.submitRendererReply({
      ownerId: 71,
      submission: CommandApprovalReplySubmissionV1Schema.parse({
        protocol_version: 1,
        kind: 'command_approval_reply_submission',
        page_ticket: page.page_ticket,
        approval_request_id: pending.approval_request_id,
        choice: 'allow_once',
      }),
    })).toEqual({ success: true, status: 'accepted' });

    await expect(execution).resolves.toMatchObject({
      status: 'completed',
      presentation: {
        permission: { source: 'allow_once' },
        timing: { status: 'started', started_at_ms: 200 },
      },
    });
    expect(approval.readRendererPage({
      ownerId: 71,
      pageTicket: page.page_ticket,
    })?.pending).toEqual([]);
    expect(f.lifecycle).toEqual(['admission', 'prepare:pipe', 'start:pipe']);
  });

  it('批准记忆写入失败时明确失败且不启动，已取消请求甚至不进入 admission', async () => {
    const persistenceFailure = fixture({
      approvalChoice: 'allow_for_conversation',
      failRemember: true,
    });
    await expect(persistenceFailure.runtime.executeShell(
      shellRequest({ command: 'rm file.txt' }),
    )).resolves.toMatchObject({ status: 'rejected', code: 'permission_unavailable' });
    expect(persistenceFailure.lifecycle).toEqual([
      'admission',
      'approval:requested',
      'approval:persisted',
      'approval:settled:failed',
    ]);
    expect(persistenceFailure.lifecycle).not.toContain('prepare:pipe');

    const cancelled = fixture();
    const abort = new AbortController();
    abort.abort();
    await expect(cancelled.runtime.executeShell({
      ...shellRequest({ command: 'printf ok' }),
      abortSignal: abort.signal,
    })).resolves.toMatchObject({ status: 'rejected', code: 'approval_denied' });
    expect(cancelled.lifecycle).toEqual([]);
  });

  it('审批等待期间 abort 形成 invalidated 终态并释放 reservation', async () => {
    const abort = new AbortController();
    const f = fixture({
      invalidateWhenAborted: true,
      onApprovalRequest: () => abort.abort(),
    });
    await expect(f.runtime.executeShell({
      ...shellRequest({ command: 'rm file.txt' }),
      abortSignal: abort.signal,
    })).resolves.toMatchObject({ status: 'rejected', code: 'permission_unavailable' });
    expect(f.lifecycle).toEqual([
      'admission',
      'approval:requested',
      'approval:settled:invalidated',
    ]);
    expect(f.launches).toHaveLength(0);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('读取对话批准期间取消时不会越过授权门，并释放已建立的 reservation', async () => {
    const listBarrier = deferred<void>();
    const abort = new AbortController();
    const f = fixture({ listBarrier });
    const execution = f.runtime.executeShell({
      ...shellRequest({ command: 'printf ok' }),
      abortSignal: abort.signal,
    });

    await expect.poll(
      () => f.owner.readActivitySnapshot().reservedCount,
    ).toBe(1);
    abort.abort();
    listBarrier.resolve();

    await expect(execution).resolves.toMatchObject({
      status: 'rejected',
      code: 'permission_unavailable',
    });
    expect(f.launches).toHaveLength(0);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('授权编排异常不会泄漏 reservation', async () => {
    const executionUuid = randomUUID();
    let uuidCall = 0;
    const f = fixture({
      createUuid: () => {
        uuidCall += 1;
        return uuidCall === 1 ? executionUuid : 'invalid-approval-uuid';
      },
    });

    await expect(f.runtime.executeShell(
      shellRequest({ command: 'rm file.txt' }),
    )).resolves.toMatchObject({ status: 'rejected', code: 'permission_unavailable' });
    expect(f.launches).toHaveLength(0);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('批准落库后请求被取消时精准撤销本次记忆且不启动', async () => {
    const abort = new AbortController();
    const f = fixture({
      approvalChoice: 'allow_for_conversation',
      onApprovalSettle: () => abort.abort(),
    });

    await expect(f.runtime.executeShell({
      ...shellRequest({ command: 'rm file.txt' }),
      abortSignal: abort.signal,
    })).resolves.toMatchObject({ status: 'rejected', code: 'permission_unavailable' });
    expect(f.lifecycle).toContain('approval:persisted');
    expect(f.lifecycle).toContain('approval:revoked');
    expect(f.approvals.values).toHaveLength(0);
    expect(f.launches).toHaveLength(0);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('授权审计落盘后请求取消时追加未启动终点，不伪造 execution terminal', async () => {
    const abort = new AbortController();
    const f = fixture({
      approvalChoice: 'allow_for_conversation',
      onAuditRecord: event => {
        if (event.kind === 'authorization_settled') abort.abort();
      },
    });

    await expect(f.runtime.executeShell({
      ...shellRequest({ command: 'rm file.txt' }),
      abortSignal: abort.signal,
    })).resolves.toMatchObject({ status: 'rejected', code: 'approval_denied' });
    expect(f.auditEvents.map(event => event.kind)).toEqual([
      'proposal_created',
      'authorization_settled',
      'execution_rejected',
    ]);
    expect(f.auditEvents[2]).toMatchObject({
      reason: 'request_cancelled',
      resource_state: 'not_acquired',
    });
    expect(f.launches).toHaveLength(0);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('未启动终点审计失败时仍保持零 spawn，并明确返回 audit unavailable', async () => {
    const abort = new AbortController();
    const f = fixture({
      failAuditKinds: new Set<CommandExecutionAuditEvent['kind']>(['execution_rejected']),
      onAuditRecord: event => {
        if (event.kind === 'authorization_settled') abort.abort();
      },
    });

    await expect(f.runtime.executeShell({
      ...shellRequest({ command: 'printf never' }),
      abortSignal: abort.signal,
    })).resolves.toMatchObject({ status: 'rejected', code: 'audit_unavailable' });
    expect(f.auditFailureStages).toEqual(['execution_rejected']);
    expect(f.launches).toHaveLength(0);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('授权后发现 Shell 与环境快照不一致时记录 launch rejection，且零 prepare', async () => {
    const f = fixture({ mismatchRuntimeSnapshot: true });

    await expect(f.runtime.executeShell(shellRequest({ command: 'printf never' })))
      .resolves.toMatchObject({ status: 'rejected', code: 'runtime_unavailable' });
    expect(f.auditEvents[f.auditEvents.length - 1]).toMatchObject({
      kind: 'execution_rejected',
      reason: 'launch_context_unavailable',
      resource_state: 'not_acquired',
    });
    expect(f.lifecycle).toEqual(['admission']);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('runtime prepare 抛错时 owner 先释放 reservation，再记录 preparation rejection', async () => {
    const f = fixture({ failPrepare: true });

    await expect(f.runtime.executeShell(shellRequest({ command: 'printf never' })))
      .resolves.toMatchObject({ status: 'rejected', code: 'execution_failed' });
    expect(f.auditEvents[f.auditEvents.length - 1]).toMatchObject({
      kind: 'execution_rejected',
      reason: 'runtime_preparation_failed',
      resource_state: 'released',
    });
    expect(f.lifecycle).toEqual(['admission', 'prepare:pipe']);
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('启动与 cleanup 同时失败时记录 release unconfirmed，不伪造 terminal', async () => {
    const f = fixture({ failStart: true, failStop: true });

    await expect(f.runtime.executeShell(shellRequest({ command: 'printf never' })))
      .resolves.toMatchObject({ status: 'rejected', code: 'execution_failed' });
    expect(f.auditEvents[f.auditEvents.length - 1]).toMatchObject({
      kind: 'execution_rejected',
      reason: 'runtime_cleanup_failed',
      resource_state: 'release_unconfirmed',
    });
    expect(f.auditEvents.some(event => event.kind === 'execution_terminal')).toBe(false);
    expect(f.lifecycle).toEqual(['admission', 'prepare:pipe', 'start:pipe', 'stop']);
  });

  it('授权后取消但批准撤销失败时记录独立原因，仍不进入 prepare', async () => {
    const abort = new AbortController();
    const f = fixture({
      approvalChoice: 'allow_for_conversation',
      failRevoke: true,
      onAuditRecord: event => {
        if (event.kind === 'authorization_settled') abort.abort();
      },
    });

    await expect(f.runtime.executeShell({
      ...shellRequest({ command: 'rm file.txt' }),
      abortSignal: abort.signal,
    })).resolves.toMatchObject({ status: 'rejected', code: 'permission_unavailable' });
    expect(f.auditEvents[f.auditEvents.length - 1]).toMatchObject({
      kind: 'execution_rejected',
      reason: 'approval_revoke_failed',
      resource_state: 'not_acquired',
    });
    expect(f.lifecycle).not.toContain('prepare:pipe');
    expect(f.owner.readActivitySnapshot().reservedCount).toBe(0);
  });

  it('删除 tombstone 在审批期间先赢时撤销新批准且绝不启动', async () => {
    let owner: ReturnType<typeof createLocalCommandExecutionOwner> | undefined;
    const f = fixture({
      approvalChoice: 'allow_for_conversation',
      onApprovalRequest: () => owner?.beginConversationStop(CONVERSATION_ID),
    });
    owner = f.owner;
    const result = await f.runtime.executeShell(shellRequest({ command: 'rm file.txt' }));

    expect(result).toMatchObject({ status: 'rejected', code: 'capacity_unavailable' });
    expect(f.lifecycle).toContain('approval:persisted');
    expect(f.lifecycle).toContain('approval:revoked');
    expect(f.lifecycle).not.toContain('prepare:pipe');
    expect(f.approvals.values).toHaveLength(0);
    expect(f.auditEvents[f.auditEvents.length - 1]).toMatchObject({
      kind: 'execution_rejected',
      reason: 'owner_rejected',
      resource_state: 'not_acquired',
    });
  });

  it('pipe 返回 opaque handle，process 支持 poll/cancel 且跨 run 只能看到 unknown', async () => {
    const f = fixture();
    const started = await f.runtime.executeShell(shellRequest({ command: 'printf ok' }));
    expect(started.status).toBe('running');
    if (started.status !== 'running') return;
    expect(started.presentation).toMatchObject({
      permission: { source: 'global_setting' },
      timing: { status: 'started', started_at_ms: 200 },
    });
    expect(started.presentation.audit_status).toBeUndefined();

    const processRequest = (runId: string, action: ExecuteProcessToolRequest['arguments']['action']): ExecuteProcessToolRequest => ({
      arguments: { process_handle: started.processHandle, action },
      conversationId: CONVERSATION_ID,
      agentRunId: CommandAgentRunIdSchema.parse(runId),
      controlToolCallId: CommandControlToolCallIdSchema.parse(`process-call-${runId}`),
      commandRunPermission: runPermission(runId),
    });
    await expect(f.runtime.executeProcess(processRequest('agent-run-other', {
      type: 'poll',
      cursor: started.nextCursor,
    }))).resolves.toMatchObject({ status: 'rejected', code: 'unknown_handle' });
    const polled = await f.runtime.executeProcess(processRequest('agent-run-a', {
      type: 'poll',
      cursor: started.nextCursor,
    }));
    expect(polled).toMatchObject({ status: 'running' });
    if (polled.status === 'running') {
      expect(polled.presentation.audit_status).toBeUndefined();
    }
    const cancelled = await f.runtime.executeProcess(processRequest('agent-run-a', {
      type: 'cancel',
    }));
    expect(cancelled).toMatchObject({
      status: 'completed',
      terminal: { outcome: 'terminated', reason: 'cancelled' },
    });
    if (cancelled.status === 'completed') {
      expect(cancelled.presentation.audit_status).toBeUndefined();
    }
    expect(f.auditEvents.filter(event => event.kind === 'process_action')).toMatchObject([
      {
        kind: 'process_action',
        result: { status: 'running' },
        action: { type: 'poll' },
      },
      {
        kind: 'process_action',
        result: { status: 'completed' },
        action: { type: 'cancel' },
      },
    ]);
    expect(f.auditEvents.filter(event => event.kind === 'execution_terminal')).toHaveLength(1);
  });

  it('终态 replay 到期后，正式 process 入口返回 expired 并记录原 execution', async () => {
    let ownerTimeMs = NOW;
    const f = fixture({ ownerNow: () => ownerTimeMs });
    const processRequest = (
      processHandle: ExecuteProcessToolRequest['arguments']['process_handle'],
      action: ExecuteProcessToolRequest['arguments']['action'],
      callId: string,
    ): ExecuteProcessToolRequest => ({
      arguments: { process_handle: processHandle, action },
      conversationId: CONVERSATION_ID,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-a'),
      controlToolCallId: CommandControlToolCallIdSchema.parse(callId),
      commandRunPermission: runPermission('agent-run-a'),
    });

    const started = await f.runtime.executeShell(shellRequest({ command: 'printf replay' }));
    if (started.status !== 'running') throw new Error('runtime did not return a handle');
    await expect(f.runtime.executeProcess(processRequest(
      started.processHandle,
      { type: 'cancel' },
      'process-call-replay-cancel',
    ))).resolves.toMatchObject({ status: 'completed' });

    ownerTimeMs += 30 * 60 * 1_000;
    await expect(f.runtime.executeProcess(processRequest(
      started.processHandle,
      { type: 'poll', cursor: started.nextCursor },
      'process-call-replay-expired',
    ))).resolves.toEqual({
      status: 'rejected',
      code: 'handle_expired',
      observation: 'The process handle has expired.',
      audit_status: 'complete',
    });
    expect(f.auditEvents[f.auditEvents.length - 1]).toMatchObject({
      kind: 'process_action',
      result: { status: 'rejected', code: 'handle_expired' },
    });
  });

  it('Process 终态只在已知 terminal 审计失败时标记 incomplete，不用 action 成功冒充完整', async () => {
    const f = fixture({
      failAuditKinds: new Set<CommandExecutionAuditEvent['kind']>(['execution_terminal']),
    });
    const started = await f.runtime.executeShell(shellRequest({ command: 'sleep 1' }));
    expect(started.status).toBe('running');
    if (started.status !== 'running') return;

    const completed = await f.runtime.executeProcess({
      arguments: {
        process_handle: started.processHandle,
        action: { type: 'cancel' },
      },
      conversationId: CONVERSATION_ID,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-a'),
      controlToolCallId: CommandControlToolCallIdSchema.parse('process-call-terminal-audit-failure'),
      commandRunPermission: runPermission(),
    });
    expect(completed).toMatchObject({
      status: 'completed',
      presentation: { audit_status: 'incomplete' },
    });
    expect(f.auditFailureStages).toContain('execution_terminal');
  });

  it('root 权限快照可由 child Agent 启动并控制自己 scope 内的进程', async () => {
    const f = fixture();
    const started = await f.runtime.executeShell(shellRequest({
      command: 'printf child',
      runId: 'agent-run-child',
      rootRunId: 'agent-run-root',
    }));
    expect(started.status).toBe('running');
    if (started.status !== 'running') return;

    const childPermission = runPermission('agent-run-root');
    await expect(f.runtime.executeProcess({
      arguments: {
        process_handle: started.processHandle,
        action: { type: 'poll', cursor: started.nextCursor },
      },
      conversationId: CONVERSATION_ID,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-child'),
      controlToolCallId: CommandControlToolCallIdSchema.parse('process-call-child-poll'),
      commandRunPermission: childPermission,
    })).resolves.toMatchObject({ status: 'running' });
    await expect(f.runtime.executeProcess({
      arguments: {
        process_handle: started.processHandle,
        action: { type: 'cancel' },
      },
      conversationId: CONVERSATION_ID,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-child'),
      controlToolCallId: CommandControlToolCallIdSchema.parse('process-call-child-cancel'),
      commandRunPermission: childPermission,
    })).resolves.toMatchObject({
      status: 'completed',
      terminal: { outcome: 'terminated', reason: 'cancelled' },
    });
  });

  it('已知 pipe handle 的输入拒绝保留真实代码，审计失败只标记不完整', async () => {
    const f = fixture({
      failAuditKinds: new Set<CommandExecutionAuditEvent['kind']>(['process_action']),
    });
    const started = await f.runtime.executeShell(shellRequest({ command: 'sleep 1' }));
    expect(started.status).toBe('running');
    if (started.status !== 'running') return;

    await expect(f.runtime.executeProcess({
      arguments: {
        process_handle: started.processHandle,
        action: { type: 'write', input: 'value' },
      },
      conversationId: CONVERSATION_ID,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-a'),
      controlToolCallId: CommandControlToolCallIdSchema.parse('process-call-rejected-write'),
      commandRunPermission: runPermission(),
    })).resolves.toMatchObject({
      status: 'rejected',
      code: 'stdin_closed',
      audit_status: 'incomplete',
    });
    expect(f.auditFailureStages).toContain('process_action');
    expect(f.auditFailureBindings).toHaveLength(1);
    await f.owner.endAndWait();
  });

  it('handle 发布后的首次输出查询失败时先终止进程再返回错误', async () => {
    const f = fixture({ failFirstQuery: true });

    await expect(f.runtime.executeShell(
      shellRequest({ command: 'printf ok' }),
    )).resolves.toMatchObject({ status: 'rejected', code: 'execution_failed' });
    expect(f.lifecycle).toContain('query:rejected');
    expect(f.lifecycle).toContain('stop');
    expect(f.baseOwner.readActivitySnapshot()).toMatchObject({
      reservedCount: 0,
      startingCount: 0,
      runningCount: 0,
      stoppingCount: 0,
    });
  });

  it('显式 interactive 只走 PTY prepared runtime，并接通 process interaction', async () => {
    const f = fixture();
    const started = await f.runtime.executeShell(shellRequest({
      command: 'read value',
      interactive: true,
    }));
    expect(started.status).toBe('running');
    if (started.status !== 'running') return;
    expect(f.launches[0]).toMatchObject({
      mode: 'pty',
      terminal_size: { columns: 80, rows: 24 },
    });
    expect(f.lifecycle).not.toContain('prepare:pipe');

    await expect(f.runtime.executeProcess({
      arguments: {
        process_handle: started.processHandle,
        action: { type: 'submit', input: 'hello' },
      },
      conversationId: CONVERSATION_ID,
      agentRunId: CommandAgentRunIdSchema.parse('agent-run-a'),
      controlToolCallId: CommandControlToolCallIdSchema.parse('process-call-submit'),
      commandRunPermission: runPermission(),
    })).resolves.toEqual({
      status: 'accepted',
      audit_status: 'complete',
      observation: 'Process interaction accepted.',
    });
    expect(f.lifecycle).toContain('pty:submit');
    const interactionAudit = f.auditEvents.find(event => (
      event.kind === 'process_action' && event.action.type === 'submit'
    ));
    expect(interactionAudit).toMatchObject({
      action: { type: 'submit', input_bytes: 5 },
      result: { status: 'accepted' },
    });
    expect(JSON.stringify(interactionAudit)).not.toContain('hello');
    await f.owner.endAndWait();
  });
});
