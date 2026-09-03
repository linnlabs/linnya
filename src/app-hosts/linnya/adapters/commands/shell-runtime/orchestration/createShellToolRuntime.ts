import { randomUUID } from 'node:crypto';

import {
  CommandExecutionIdentitySchema,
  CommandControlToolCallIdSchema,
  CommandPermissionSnapshotV1Schema,
  ProcessControlRequestV1Schema,
  ProcessOutputCursorSchema,
  ShellCommandProposalV1Schema,
  type CommandExecutionOwnerBindingV1,
  type CommandExecutionTerminalV1,
  type ProcessControlRequestV1,
} from '@app/schemas/commands';
import {
  authorizeCommandProposal,
  createInitialCommandPermissionSnapshot,
  isProcessCancellationRequest,
  isProcessInteractionRequest,
  resolveShellHardTimeout,
  resolveShellInitialWait,
  resolveShellLaunchRequest,
  validateShellCommandInput,
  type CommandApprovalPort,
  type ConversationCommandApprovalPort,
  type ProcessCancellationRequestV1,
  type ShellWorkingDirectoryFileSystemPort,
} from '../../../../../../domains/commands';
import type {
  ConversationWorkDirectoryAdmissionPort,
} from '../../../../application/conversation-lifecycle';
import {
  projectCommandExecutionAuditRuntimeSummary,
  type CommandExecutionAuditEvent,
  type CommandExecutionAuditPort,
} from '../../../../../../domains/audit/features/command-execution-audit';
import type {
  CommandExecutionAuditFailurePort,
  CommandExecutionAuditDiagnosticPort,
  ExecuteProcessToolRequest,
  ExecuteShellToolRequest,
  ProcessToolRuntimeResult,
  ShellCommandRuntimeBackend,
  ShellToolRuntimePort,
  ShellToolRuntimeResult,
} from '../definitions';
import {
  freezeShellLaunchRuntimeContext,
  projectCommandOutputStore,
  projectCommandExecutionPresentationFacts,
  projectProcessObservationDisplay,
  projectProcessObservationText,
  projectProcessToolRejectionCode,
  projectShellToolTerminal,
} from '../functions';
import { withShellWorkingDirectoryAdmission } from './withShellWorkingDirectoryAdmission';

const INITIAL_OUTPUT_CURSOR = ProcessOutputCursorSchema.parse(0);
const PROCESS_INPUT_ENCODER = new TextEncoder();

class ShellReservationUnavailableError extends Error {}

function rejectedShell(
  code: Extract<ShellToolRuntimeResult, { readonly status: 'rejected' }>['code'],
  observation: string,
): ShellToolRuntimeResult {
  return { status: 'rejected', code, observation };
}

function rejectedProcess(
  code: Extract<ProcessToolRuntimeResult, { readonly status: 'rejected' }>['code'],
  observation: string,
): ProcessToolRuntimeResult {
  return { status: 'rejected', code, observation };
}

function waitForTerminal(
  terminal: Promise<CommandExecutionTerminalV1>,
  waitMs: number,
): Promise<CommandExecutionTerminalV1 | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: CommandExecutionTerminalV1 | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(undefined), waitMs);
    void terminal.then(finish, () => finish(undefined));
  });
}

function buildProcessRequest(input: {
  readonly request: ExecuteProcessToolRequest;
  readonly ownerGenerationId: string;
}): ProcessControlRequestV1 {
  return ProcessControlRequestV1Schema.parse({
    protocol_version: 1,
    kind: 'process_control_request',
    process_handle: input.request.arguments.process_handle,
    scope: {
      conversation_id: input.request.conversationId,
      agent_run_id: input.request.agentRunId,
      control_tool_call_id: input.request.controlToolCallId,
      owner_generation_id: input.ownerGenerationId,
    },
    action: input.request.arguments.action,
  });
}

type ProcessActionAuditSummary = Extract<
  CommandExecutionAuditEvent,
  { readonly kind: 'process_action' }
>['action'];

type ExecutionRejectedAuditEvent = Extract<
  CommandExecutionAuditEvent,
  { readonly kind: 'execution_rejected' }
>;

function projectProcessActionAuditSummary(
  action: ProcessControlRequestV1['action'],
): ProcessActionAuditSummary {
  switch (action.type) {
    case 'poll':
      return { type: action.type, cursor: action.cursor };
    case 'wait':
      return {
        type: action.type,
        cursor: action.cursor,
        wait_timeout_ms: action.wait_timeout_ms,
      };
    case 'cancel':
    case 'eof':
      return { type: action.type };
    case 'write':
    case 'submit':
      // 交互正文可能包含密码或 token；审计只保存协议已经校验过的 UTF-8 byte 数。
      return {
        type: action.type,
        input_bytes: PROCESS_INPUT_ENCODER.encode(action.input).byteLength,
      };
    case 'resize':
      return { type: action.type, columns: action.columns, rows: action.rows };
  }
}

export interface ShellToolRuntimeDependencies {
  readonly backend: ShellCommandRuntimeBackend;
  readonly conversationAdmission: ConversationWorkDirectoryAdmissionPort;
  readonly workingDirectoryFileSystem: ShellWorkingDirectoryFileSystemPort;
  readonly approvals: ConversationCommandApprovalPort;
  readonly approval: CommandApprovalPort;
  readonly audit: CommandExecutionAuditPort;
  readonly auditFailures: CommandExecutionAuditFailurePort;
  readonly auditDiagnostics: CommandExecutionAuditDiagnosticPort;
  readonly createUuid?: () => string;
  readonly now?: () => number;
}

/**
 * Shell/process 的唯一 App-host 用例组合。业务规则留在 Commands functions，平台资源留在
 * prepared runtime；这里仅固定 admission、审批、owner handoff 和初始等待的先后关系。
 */
export function createShellToolRuntime(
  dependencies: ShellToolRuntimeDependencies,
): ShellToolRuntimePort {
  const createUuid = dependencies.createUuid ?? randomUUID;
  const now = dependencies.now ?? Date.now;
  const owner = dependencies.backend.owner;

  async function executeShell(
    request: ExecuteShellToolRequest,
  ): Promise<ShellToolRuntimeResult> {
    const validated = validateShellCommandInput(request.arguments);
    if (validated.status === 'rejected') {
      return rejectedShell('invalid_arguments', 'Invalid shell arguments.');
    }
    if (
      request.commandRunPermission.status !== 'available'
    ) {
      return rejectedShell('permission_unavailable', 'Command permission is unavailable.');
    }
    const runPermissionSnapshot = request.commandRunPermission.snapshot;
    if (request.abortSignal?.aborted) {
      return rejectedShell('approval_denied', 'The command request was cancelled.');
    }

    let runtimeContext;
    try {
      runtimeContext = freezeShellLaunchRuntimeContext(
        dependencies.backend.readLaunchRuntimeContext(),
      );
    } catch {
      return rejectedShell('runtime_unavailable', 'The command runtime is unavailable.');
    }
    const ownerSnapshot = owner.readActivitySnapshot();
    if (ownerSnapshot.lifecycle !== 'active') {
      return rejectedShell('capacity_unavailable', 'The command owner is not accepting work.');
    }
    const mode = validated.input.interactive ? 'pty' as const : 'pipe' as const;
    const hardTimeout = resolveShellHardTimeout({
      requestedHardTimeoutMs: validated.input.requestedHardTimeoutMs,
      runtime: runtimeContext,
    });
    if (hardTimeout.status === 'rejected') {
      return rejectedShell('invalid_arguments', 'Invalid shell hard timeout.');
    }

    let admitted: {
      readonly binding: CommandExecutionOwnerBindingV1;
      readonly proposal: ReturnType<typeof ShellCommandProposalV1Schema.parse>;
      readonly conversationRoot: string;
    };
    try {
      admitted = await withShellWorkingDirectoryAdmission({
        request: {
          conversationId: request.conversationId,
          requestedCwd: validated.input.requestedCwd,
          platform: runtimeContext.shell.platform,
          permissionLevel: runPermissionSnapshot.permission_level,
        },
        conversationAdmission: dependencies.conversationAdmission,
        fileSystem: dependencies.workingDirectoryFileSystem,
        admitted(directory) {
          const identity = CommandExecutionIdentitySchema.parse({
            conversation_id: request.conversationId,
            agent_run_id: request.agentRunId,
            origin_tool_call_id: request.originToolCallId,
            command_execution_id: `command_execution_${createUuid()}`,
            owner_generation_id: ownerSnapshot.generationId,
            created_at_ms: now(),
          });
          const permission = createInitialCommandPermissionSnapshot({
            runSnapshot: runPermissionSnapshot,
            identity,
          });
          const proposal = ShellCommandProposalV1Schema.parse({
            protocol_version: 1,
            kind: 'shell_command_proposal',
            identity,
            command: validated.input.command,
            cwd: directory.workingDirectory.canonicalPath,
            permission,
          });
          const reservation = owner.reserve({ identity, mode });
          if (reservation.status === 'rejected') {
            throw new ShellReservationUnavailableError(reservation.code);
          }
          return Object.freeze({
            binding: reservation.binding,
            proposal,
            conversationRoot: directory.workingDirectory.canonicalConversationRoot,
          });
        },
      });
    } catch (error: unknown) {
      if (error instanceof ShellReservationUnavailableError) {
        return rejectedShell(
          'capacity_unavailable',
          'The command owner is not accepting work.',
        );
      }
      return rejectedShell(
        'working_directory_unavailable',
        'The command working directory is unavailable.',
      );
    }

    const releaseReservation = (): 'released' | 'release_unconfirmed' => {
      const released = owner.release(admitted.binding);
      // claim/prepare 失败会由 owner 先删除 reservation；此时 unknown_reservation
      // 证明当前 binding 已经不再持有资源，不能误报成释放未知。
      return released.status === 'released'
        || released.code === 'unknown_reservation'
        ? 'released'
        : 'release_unconfirmed';
    };
    try {
      await dependencies.audit.record({
        kind: 'proposal_created',
        occurred_at_ms: now(),
        proposal: admitted.proposal,
        binding: admitted.binding,
      });
    } catch {
      dependencies.auditDiagnostics.recordFailure({
        binding: admitted.binding,
        stage: 'proposal_created',
      });
      releaseReservation();
      return rejectedShell(
        'audit_unavailable',
        'The command audit record is unavailable.',
      );
    }
    let authorization;
    try {
      authorization = await authorizeCommandProposal({
        proposal: admitted.proposal,
        permissionRequirement: {
          identity: admitted.proposal.identity,
          level: validated.input.requiresWriteAccess ? 'standard' : 'selected_level',
        },
        platform: runtimeContext.shell.platform,
        shellSemanticsId: runtimeContext.shell.shell_semantics_id,
        approvals: dependencies.approvals,
        approval: dependencies.approval,
        createApprovalRequestUuid: createUuid,
        now,
        ...(request.abortSignal ? { abortSignal: request.abortSignal } : {}),
      });
    } catch {
      authorization = { status: 'rejected', code: 'permission_unavailable' } as const;
    }
    try {
      await dependencies.audit.record({
        kind: 'authorization_settled',
        occurred_at_ms: now(),
        identity: admitted.proposal.identity,
        settlement: authorization.status === 'authorized'
          ? {
              outcome: 'authorized',
              permission: authorization.permission,
              ...(authorization.approvalRequestId
                ? { approval_request_id: authorization.approvalRequestId }
                : {}),
            }
          : {
              outcome: 'rejected',
              code: authorization.code,
              ...(authorization.approval?.settlement.approval_request_id
                ? {
                    approval_request_id:
                      authorization.approval.settlement.approval_request_id,
                  }
                : {}),
            },
        ...(authorization.approval
          ? { approval_settlement: authorization.approval.settlement }
          : {}),
      });
    } catch {
      dependencies.auditDiagnostics.recordFailure({
        binding: admitted.binding,
        stage: 'authorization_settled',
      });
      if (authorization.status === 'authorized' && authorization.persistedApproval?.created) {
        try {
          await dependencies.approvals.revoke(
            authorization.persistedApproval.approvalRequestId,
          );
        } catch {
          releaseReservation();
          return rejectedShell(
            'permission_unavailable',
            'The failed command approval could not be revoked.',
          );
        }
      }
      releaseReservation();
      return rejectedShell(
        'audit_unavailable',
        'The command authorization audit record is unavailable.',
      );
    }
    if (authorization.status === 'rejected') {
      releaseReservation();
      return rejectedShell(
        authorization.code,
        authorization.code === 'approval_denied'
          ? 'The command was not approved.'
          : 'Command authorization is unavailable.',
      );
    }

    const recordExecutionRejected = async (
      reason: ExecutionRejectedAuditEvent['reason'],
      resourceState: ExecutionRejectedAuditEvent['resource_state'],
    ): Promise<boolean> => {
      try {
        await dependencies.audit.record({
          kind: 'execution_rejected',
          occurred_at_ms: now(),
          identity: admitted.proposal.identity,
          reason,
          resource_state: resourceState,
        });
        return true;
      } catch {
        dependencies.auditDiagnostics.recordFailure({
          binding: admitted.binding,
          stage: 'execution_rejected',
        });
        return false;
      }
    };

    const rejectAuthorizedExecution = async (input: {
      readonly reason: ExecutionRejectedAuditEvent['reason'];
      readonly resourceState: ExecutionRejectedAuditEvent['resource_state'];
      readonly code: Extract<ShellToolRuntimeResult, { readonly status: 'rejected' }>['code'];
      readonly observation: string;
    }): Promise<ShellToolRuntimeResult> => {
      const audited = await recordExecutionRejected(input.reason, input.resourceState);
      return audited
        ? rejectedShell(input.code, input.observation)
        : rejectedShell('audit_unavailable', 'The command rejection audit record is unavailable.');
    };

    if (request.abortSignal?.aborted) {
      if (authorization.persistedApproval?.created) {
        try {
          await dependencies.approvals.revoke(
            authorization.persistedApproval.approvalRequestId,
          );
        } catch {
          releaseReservation();
          return rejectAuthorizedExecution({
            reason: 'approval_revoke_failed',
            resourceState: 'not_acquired',
            code: 'permission_unavailable',
            observation: 'The cancelled approval could not be revoked.',
          });
        }
      }
      releaseReservation();
      return rejectAuthorizedExecution({
        reason: 'request_cancelled',
        resourceState: 'not_acquired',
        code: 'approval_denied',
        observation: 'The command request was cancelled.',
      });
    }

    const launch = resolveShellLaunchRequest({
      authorized: {
        context: authorization.context,
        proposal: admitted.proposal,
        permission: CommandPermissionSnapshotV1Schema.parse(authorization.permission),
      },
      runtime: {
        shell: runtimeContext.shell,
        environment: runtimeContext.environment,
        hardTimeoutMs: hardTimeout.hardTimeoutMs,
      },
      mode: mode === 'pipe'
        ? { mode }
        : { mode, terminalSize: dependencies.backend.initialPtySize },
      conversationRoot: admitted.conversationRoot,
    });
    if (launch.status === 'rejected') {
      releaseReservation();
      return rejectAuthorizedExecution({
        reason: 'launch_context_unavailable',
        resourceState: 'not_acquired',
        code: 'runtime_unavailable',
        observation: 'The command launch context is unavailable.',
      });
    }

    let prepared: ReturnType<ShellCommandRuntimeBackend['preparePipe']> | undefined;
    let started;
    try {
      started = await owner.claimAndStart({
        binding: admitted.binding,
        prepareRuntime: () => {
          prepared = launch.launch.mode === 'pipe'
            ? dependencies.backend.preparePipe(launch.launch, {
                instanceId: request.toolOutputInstanceId,
              })
            : dependencies.backend.preparePty(launch.launch, {
                instanceId: request.toolOutputInstanceId,
              });
          return prepared;
        },
      });
    } catch {
      const resourceState = releaseReservation();
      return rejectAuthorizedExecution({
        reason: resourceState === 'released'
          ? 'runtime_preparation_failed'
          : 'runtime_cleanup_failed',
        resourceState,
        code: 'execution_failed',
        observation: 'The command could not be started.',
      });
    }
    if (started.status === 'rejected') {
      if (authorization.persistedApproval?.created) {
        try {
          await dependencies.approvals.revoke(
            authorization.persistedApproval.approvalRequestId,
          );
        } catch {
          releaseReservation();
          return rejectAuthorizedExecution({
            reason: 'approval_revoke_failed',
            resourceState: 'not_acquired',
            code: 'permission_unavailable',
            observation: 'The cancelled approval could not be revoked.',
          });
        }
      }
      releaseReservation();
      return rejectAuthorizedExecution({
        reason: 'owner_rejected',
        resourceState: 'not_acquired',
        code: 'capacity_unavailable',
        observation: 'The command owner is not accepting work.',
      });
    }
    if (!prepared) {
      return rejectAuthorizedExecution({
        reason: 'runtime_invariant_failed',
        resourceState: 'release_unconfirmed',
        code: 'execution_failed',
        observation: 'The command runtime was not prepared.',
      });
    }

    const reportAuditFailure = (): void => {
      dependencies.auditFailures.report(admitted.binding);
    };
    const recordPostStartAudit = async (
      event: Exclude<CommandExecutionAuditEvent, { readonly kind: 'protected_input' }>,
    ): Promise<'complete' | 'incomplete'> => {
      try {
        await dependencies.audit.record(event);
        return dependencies.auditFailures.hasFailure(admitted.binding)
          ? 'incomplete'
          : 'complete';
      } catch {
        dependencies.auditDiagnostics.recordFailure({
          binding: admitted.binding,
          stage: event.kind,
        });
        reportAuditFailure();
        return 'incomplete';
      }
    };
    if (started.startedAtMs !== undefined) {
      await recordPostStartAudit({
        kind: 'execution_started',
        occurred_at_ms: started.startedAtMs,
        identity: admitted.proposal.identity,
        mode,
        process_handle: admitted.binding.process_handle,
        runtime: projectCommandExecutionAuditRuntimeSummary(launch.launch),
      });
    }
    let terminalAuditPromise: Promise<'complete' | 'incomplete'> | undefined;
    const recordTerminalAudit = (
      terminal: CommandExecutionTerminalV1,
    ): Promise<'complete' | 'incomplete'> => {
      terminalAuditPromise ??= recordPostStartAudit({
        kind: 'execution_terminal',
        occurred_at_ms: terminal.settled_at_ms,
        terminal,
      });
      return terminalAuditPromise;
    };

    if (started.status === 'terminal') {
      owner.discardUnpublishedHandle(admitted.binding);
      const auditStatus = await recordTerminalAudit(started.terminal);
      const observed = prepared.outputObservation.read(INITIAL_OUTPUT_CURSOR);
      const commandOutputStore = projectCommandOutputStore(await prepared.settledTextOutput);
      return {
        status: 'completed',
        terminal: projectShellToolTerminal(started.terminal),
        command_output_store: commandOutputStore,
        presentation: projectCommandExecutionPresentationFacts({
          permission: authorization.permission,
          permissionSource: authorization.presentationSource,
          ...(started.startedAtMs === undefined
            ? {}
            : { startedAtMs: started.startedAtMs }),
          settledAtMs: started.terminal.settled_at_ms,
          auditStatus,
        }),
        ...(observed.status === 'observed'
          ? { display: projectProcessObservationDisplay(observed.observation) }
          : {}),
        observation: observed.status === 'observed'
          ? projectProcessObservationText(observed.observation)
          : '(output unavailable)',
      };
    }

    // Shell 已把真实进程交给 owner 后，terminal 审计必须独立于 Agent 是否继续 poll。
    // 捕获函数内部会把 sink 失败转成旁路事实，因此这里不会产生未处理 rejection。
    void started.terminal.then(recordTerminalAudit);

    const terminal = await waitForTerminal(
      started.terminal,
      resolveShellInitialWait({
        platform: runtimeContext.shell.platform,
        requestedMs: validated.input.initialWaitMs,
      }),
    );
    if (terminal) {
      owner.discardUnpublishedHandle(started.binding);
      const auditStatus = await recordTerminalAudit(terminal);
      const observed = prepared.outputObservation.read(INITIAL_OUTPUT_CURSOR);
      const commandOutputStore = projectCommandOutputStore(await prepared.settledTextOutput);
      return {
        status: 'completed',
        terminal: projectShellToolTerminal(terminal),
        command_output_store: commandOutputStore,
        presentation: projectCommandExecutionPresentationFacts({
          permission: authorization.permission,
          permissionSource: authorization.presentationSource,
          startedAtMs: started.startedAtMs,
          settledAtMs: terminal.settled_at_ms,
          auditStatus,
        }),
        ...(observed.status === 'observed'
          ? { display: projectProcessObservationDisplay(observed.observation) }
          : {}),
        observation: observed.status === 'observed'
          ? projectProcessObservationText(observed.observation)
          : '(output unavailable)',
      };
    }

    const published = owner.publishHandle(started.binding);
    if (published.status === 'rejected') {
      return rejectedShell('execution_failed', 'The command process handle is unavailable.');
    }
    const query = await owner.queryOutput(ProcessControlRequestV1Schema.parse({
      protocol_version: 1,
      kind: 'process_control_request',
      process_handle: published.binding.process_handle,
      scope: {
        conversation_id: request.conversationId,
        agent_run_id: request.agentRunId,
        control_tool_call_id: request.originToolCallId,
        owner_generation_id: ownerSnapshot.generationId,
      },
      action: { type: 'poll', cursor: INITIAL_OUTPUT_CURSOR },
    }));
    if (query.status === 'rejected') {
      const cancellationRequest: ProcessCancellationRequestV1 = {
        protocol_version: 1,
        kind: 'process_control_request',
        process_handle: published.binding.process_handle,
        scope: {
          conversation_id: request.conversationId,
          agent_run_id: request.agentRunId,
          control_tool_call_id: CommandControlToolCallIdSchema.parse(request.originToolCallId),
          owner_generation_id: ownerSnapshot.generationId,
        },
        action: { type: 'cancel' },
      };
      const cancelled = await owner.cancelAndWait(cancellationRequest);
      if (cancelled.status === 'rejected') {
        return rejectedShell(
          'execution_failed',
          'The command output failed and the process could not be stopped.',
        );
      }
      return rejectedShell('execution_failed', 'The command output is unavailable.');
    }
    if (query.status === 'terminal') {
      const auditStatus = await recordTerminalAudit(query.terminal);
      return {
        status: 'completed',
        terminal: projectShellToolTerminal(query.terminal),
        command_output_store: projectCommandOutputStore(query.settledTextOutput),
        presentation: projectCommandExecutionPresentationFacts({
          permission: authorization.permission,
          permissionSource: authorization.presentationSource,
          startedAtMs: query.startedAtMs,
          settledAtMs: query.terminal.settled_at_ms,
          auditStatus,
        }),
        display: projectProcessObservationDisplay(query.observation),
        observation: projectProcessObservationText(query.observation),
      };
    }
    return {
      status: 'running',
      processHandle: published.binding.process_handle,
      nextCursor: query.observation.nextCursor,
      presentation: projectCommandExecutionPresentationFacts({
        permission: authorization.permission,
        permissionSource: authorization.presentationSource,
        startedAtMs: query.startedAtMs,
        ...(dependencies.auditFailures.hasFailure(admitted.binding)
          ? { auditStatus: 'incomplete' as const }
          : {}),
      }),
      display: projectProcessObservationDisplay(query.observation),
      observation: projectProcessObservationText(query.observation),
    };
  }

  async function executeProcess(
    request: ExecuteProcessToolRequest,
  ): Promise<ProcessToolRuntimeResult> {
    const snapshot = owner.readActivitySnapshot();
    if (
      request.commandRunPermission.status !== 'available'
    ) {
      return rejectedProcess('unknown_handle', 'Unknown process handle.');
    }
    const control = buildProcessRequest({
      request,
      ownerGenerationId: snapshot.generationId,
    });
    const binding = owner.readPublishedBinding(control);
    const recordProcessActionAudit = async (
      result: Extract<
        CommandExecutionAuditEvent,
        { readonly kind: 'process_action' }
      >['result'],
    ): Promise<'complete' | 'incomplete' | undefined> => {
      if (!binding) return undefined;
      try {
        await dependencies.audit.record({
          kind: 'process_action',
          occurred_at_ms: now(),
          identity: binding.identity,
          control_tool_call_id: control.scope.control_tool_call_id,
          action: projectProcessActionAuditSummary(control.action),
          result,
        });
        return dependencies.auditFailures.hasFailure(binding)
          ? 'incomplete'
          : 'complete';
      } catch {
        dependencies.auditDiagnostics.recordFailure({
          binding,
          stage: 'process_action',
        });
        dependencies.auditFailures.report(binding);
        return 'incomplete';
      }
    };

    if (control.action.type === 'poll' || control.action.type === 'wait') {
      const result = await owner.queryOutput(control);
      if (result.status === 'rejected') {
        const auditStatus = await recordProcessActionAudit({ status: 'rejected', code: result.code });
        const publicCode = projectProcessToolRejectionCode(result.code);
        return {
          ...rejectedProcess(
            publicCode,
            publicCode === 'handle_expired'
              ? 'The process handle has expired.'
              : 'The process action was rejected.',
          ),
          ...(auditStatus ? { audit_status: auditStatus } : {}),
        };
      }
      const auditStatus = await recordProcessActionAudit({
        status: result.status === 'terminal' ? 'completed' : 'running',
      });
      return result.status === 'terminal'
          ? {
            status: 'completed',
            terminal: projectShellToolTerminal(result.terminal),
            command_output_store: projectCommandOutputStore(result.settledTextOutput),
            presentation: projectCommandExecutionPresentationFacts({
              startedAtMs: result.startedAtMs,
              settledAtMs: result.terminal.settled_at_ms,
              ...(auditStatus === 'incomplete' ? { auditStatus } : {}),
            }),
            display: projectProcessObservationDisplay(result.observation),
            observation: projectProcessObservationText(result.observation),
          }
        : {
            status: 'running',
            nextCursor: result.observation.nextCursor,
            presentation: projectCommandExecutionPresentationFacts({
              startedAtMs: result.startedAtMs,
              ...(auditStatus === 'incomplete' ? { auditStatus } : {}),
            }),
            display: projectProcessObservationDisplay(result.observation),
            observation: projectProcessObservationText(result.observation),
          };
    }

    if (isProcessCancellationRequest(control)) {
      const cancelled = await owner.cancelAndWait(control);
      if (cancelled.status === 'rejected') {
        const auditStatus = await recordProcessActionAudit({ status: 'rejected', code: cancelled.code });
        return {
          ...rejectedProcess(
            projectProcessToolRejectionCode(cancelled.code),
            'The process could not be cancelled.',
          ),
          ...(auditStatus ? { audit_status: auditStatus } : {}),
        };
      }
      const auditStatus = await recordProcessActionAudit({ status: 'completed' });
      const observed = await owner.queryOutput(ProcessControlRequestV1Schema.parse({
        ...control,
        action: { type: 'poll', cursor: INITIAL_OUTPUT_CURSOR },
      }));
      return {
        status: 'completed',
        terminal: projectShellToolTerminal(cancelled.terminal),
        command_output_store: projectCommandOutputStore(cancelled.settledTextOutput),
        presentation: projectCommandExecutionPresentationFacts({
          startedAtMs: cancelled.startedAtMs,
          settledAtMs: cancelled.terminal.settled_at_ms,
          ...(auditStatus === 'incomplete' ? { auditStatus } : {}),
        }),
        ...(observed.status === 'rejected'
          ? {}
          : { display: projectProcessObservationDisplay(observed.observation) }),
        observation: observed.status === 'rejected'
          ? '(output unavailable)'
          : projectProcessObservationText(observed.observation),
      };
    }

    if (!isProcessInteractionRequest(control)) {
      const auditStatus = await recordProcessActionAudit({
        status: 'rejected',
        code: 'action_not_supported',
      });
      return {
        ...rejectedProcess('incompatible_state', 'The process action is invalid.'),
        ...(auditStatus ? { audit_status: auditStatus } : {}),
      };
    }
    const interaction = await owner.controlInteraction(control);
    if (interaction.status === 'rejected') {
      const auditStatus = await recordProcessActionAudit({ status: 'rejected', code: interaction.code });
      return {
        ...rejectedProcess(
          projectProcessToolRejectionCode(interaction.code),
          'The process interaction was rejected.',
        ),
        ...(auditStatus ? { audit_status: auditStatus } : {}),
      };
    }
    const auditStatus = await recordProcessActionAudit({ status: 'accepted' });
    return {
      status: 'accepted',
      ...(auditStatus ? { audit_status: auditStatus } : {}),
      observation: 'Process interaction accepted.',
    };
  }

  return Object.freeze({ executeShell, executeProcess });
}
