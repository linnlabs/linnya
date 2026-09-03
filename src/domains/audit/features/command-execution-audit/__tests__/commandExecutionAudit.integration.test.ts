import { describe, expect, it } from 'vitest';

import {
  CommandExecutionIdentitySchema,
  CommandExecutionTerminalV1Schema,
  CommandLaunchSnapshotV1Schema,
  CommandPermissionSnapshotV1Schema,
  ShellCommandProposalV1Schema,
} from '@app/schemas/commands';

import {
  parseCommandExecutionAuditEvent,
  projectCommandExecutionAuditRuntimeSummary,
  projectCommandExecutionAuditEnvelope,
} from '..';

const identity = CommandExecutionIdentitySchema.parse({
  conversation_id: 'conversation-audit-contract',
  agent_run_id: 'run-audit-contract',
  origin_tool_call_id: 'call-shell-origin',
  command_execution_id: 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a',
  owner_generation_id: 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
  created_at_ms: 1_000,
});

const permission = CommandPermissionSnapshotV1Schema.parse({
  protocol_version: 1,
  kind: 'command_permission_snapshot',
  identity,
  base_level: 'standard',
  effective_level: 'standard',
  grant_source: 'global_setting',
  internal_data_access: 'denied',
});

const proposal = ShellCommandProposalV1Schema.parse({
  protocol_version: 1,
  kind: 'shell_command_proposal',
  identity,
  command: 'printf audit-contract',
  cwd: '/tmp/linnya-audit-contract',
  permission,
});

const launch = CommandLaunchSnapshotV1Schema.parse({
  protocol_version: 1,
  kind: 'pipe_command_launch_snapshot',
  mode: 'pipe',
  stdin: 'closed',
  proposal,
  conversation_root: '/tmp/linnya-audit-contract',
  permission,
  shell: {
    platform: 'macos',
    shell_semantics_id: 'zsh',
    shell_version: 'zsh 5.9',
    snapshot_revision: 'runtime-revision-a',
    output_text_encoding: 'utf-8',
    command_invocation_profile_id: 'plain-v1',
    executable_path: '/bin/zsh',
    argv_prefix: ['-f', '-c'],
  },
  environment: {
    revision: 'runtime-revision-a',
    entries: { AUDIT_TEST_SECRET: 'must-not-enter-audit' },
  },
  lifecycle_policy: 'terminate_with_run',
  hard_timeout_ms: 180_000,
});
const runtimeSummary = projectCommandExecutionAuditRuntimeSummary(launch);

function project(event: Parameters<typeof projectCommandExecutionAuditEnvelope>[0]['event']) {
  return projectCommandExecutionAuditEnvelope({
    event,
  });
}

function containsForbiddenKey(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => (
    ['stdout', 'stderr', 'env', 'pid', 'input'].includes(key)
    || containsForbiddenKey(child)
  ));
}

describe('command execution audit contract', () => {
  it('把唯一提案投影为带正式 Runtime 身份的审计事实', () => {
    const envelope = project({
      kind: 'proposal_created',
      occurred_at_ms: 1_010,
      proposal,
    });

    expect(envelope).toMatchObject({
      envelopeId: `audit-command:${identity.command_execution_id}:proposal_created`,
      ts: 1_010,
      runId: 'run-audit-contract',
      action: 'command.proposal.created',
      actor: { kind: 'host', name: 'linnya-command-runtime' },
      scope: {
        conversationId: 'conversation-audit-contract',
        runId: 'run-audit-contract',
        toolCallId: 'call-shell-origin',
        toolName: 'shell',
      },
    });
    expect(envelope.evidence?.[0]?.metadata).toEqual({ proposal });
  });

  it('允许提案关联冻结 binding，并保留真实审批结算', () => {
    const binding = {
      protocol_version: 1 as const,
      kind: 'command_execution_owner_binding' as const,
      identity,
      process_handle: 'command_process_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2c',
      mode: 'pty' as const,
    };
    const proposalEnvelope = project(parseCommandExecutionAuditEvent({
      kind: 'proposal_created',
      occurred_at_ms: 1_010,
      proposal,
      binding,
    }));
    expect(proposalEnvelope.evidence?.[0]?.metadata).toEqual({ proposal, binding });

    const approvedPermission = CommandPermissionSnapshotV1Schema.parse({
      ...permission,
      grant_source: 'allow_once',
    });
    const approvalSettlement = {
      protocol_version: 1 as const,
      kind: 'command_approval_settlement' as const,
      approval_request_id: 'command_approval_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2d',
      proposal_identity: identity,
      settled_at_ms: 1_015,
      outcome: 'approved' as const,
      choice: 'allow_once' as const,
      permission: approvedPermission,
    };
    const authorizationEnvelope = project(parseCommandExecutionAuditEvent({
      kind: 'authorization_settled',
      occurred_at_ms: 1_015,
      identity,
      settlement: {
        outcome: 'authorized',
        permission: approvedPermission,
        approval_request_id: approvalSettlement.approval_request_id,
      },
      approval_settlement: approvalSettlement,
    }));

    expect(authorizationEnvelope.decision).toEqual({
      outcome: 'allowed',
      policy: 'allow_once',
    });
    expect(authorizationEnvelope.evidence?.[0]?.metadata).toEqual({
      settlement: {
        outcome: 'authorized',
        permission: approvedPermission,
        approval_request_id: approvalSettlement.approval_request_id,
      },
      approval_settlement: approvalSettlement,
    });

    expect(() => parseCommandExecutionAuditEvent({
      kind: 'authorization_settled',
      occurred_at_ms: 1_015,
      identity,
      settlement: {
        outcome: 'rejected',
        code: 'approval_denied',
        approval_request_id: approvalSettlement.approval_request_id,
      },
      approval_settlement: approvalSettlement,
    })).toThrow('approved settlement must produce an authorized command');
  });

  it('终态同时保留退出、输出读取、进程树清理和资源释放事实', () => {
    const terminal = CommandExecutionTerminalV1Schema.parse({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity,
      settled_at_ms: 1_100,
      outcome: 'execution_ended',
      termination_cause: 'natural_exit',
      process_exit: { status: 'observed', exit_code: 0, signal: null },
      output_drain: { status: 'complete' },
      tree_cleanup: { status: 'succeeded' },
      resource_release: { status: 'succeeded' },
    });

    const envelope = project({
      kind: 'execution_terminal',
      occurred_at_ms: 1_101,
      terminal,
    });

    expect(envelope.action).toBe('command.execution.terminal');
    expect(envelope.evidence?.[0]?.metadata).toEqual({ terminal });
    expect(containsForbiddenKey(envelope)).toBe(false);
  });

  it('已授权但未启动时记录拒绝原因和资源状态，不伪造进程终态', () => {
    const envelope = project({
      kind: 'execution_rejected',
      occurred_at_ms: 1_019,
      identity,
      reason: 'request_cancelled',
      resource_state: 'not_acquired',
    });

    expect(envelope.action).toBe('command.execution.rejected');
    expect(envelope.scope?.toolName).toBe('shell');
    expect(envelope.evidence?.[0]?.metadata).toEqual({
      reason: 'request_cancelled',
      resource_state: 'not_acquired',
    });
    expect(envelope.envelopeId).toBe(
      `audit-command:${identity.command_execution_id}:execution_rejected`,
    );
    expect(containsForbiddenKey(envelope)).toBe(false);
  });

  it('启动事实只从冻结 launch 投影安全 runtime 摘要', () => {
    const envelope = project({
      kind: 'execution_started',
      occurred_at_ms: 1_020,
      identity,
      mode: 'pipe',
      runtime: runtimeSummary,
    });

    expect(envelope.evidence?.[0]?.metadata).toEqual({
      mode: 'pipe',
      runtime: {
        platform: 'macos',
        shell_semantics_id: 'zsh',
        shell_version: 'zsh 5.9',
        snapshot_revision: 'runtime-revision-a',
        output_text_encoding: 'utf-8',
        command_invocation_profile_id: 'plain-v1',
        executable_path: '/bin/zsh',
        hard_timeout_ms: 180_000,
      },
    });
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain('argv_prefix');
    expect(serialized).not.toContain('AUDIT_TEST_SECRET');
    expect(serialized).not.toContain('must-not-enter-audit');
  });

  it('交互输入只接受 byte 数摘要，并把控制工具身份写入 scope', () => {
    const event = parseCommandExecutionAuditEvent({
      kind: 'process_action',
      occurred_at_ms: 1_050,
      identity,
      control_tool_call_id: 'call-process-control',
      action: { type: 'write', input_bytes: 17 },
      result: { status: 'accepted' },
    });
    const envelope = project(event);

    expect(envelope.scope?.toolCallId).toBe('call-process-control');
    expect(envelope.scope?.toolName).toBe('process');
    expect(envelope.envelopeId).toBe(
      `audit-command:${identity.command_execution_id}:process_action:call-process-control`,
    );
    expect(envelope.evidence?.[0]?.metadata).toEqual({
      action: { type: 'write', input_bytes: 17 },
      result: { status: 'accepted' },
    });
    expect(containsForbiddenKey(envelope)).toBe(false);

    expect(() => parseCommandExecutionAuditEvent({
      kind: 'process_action',
      occurred_at_ms: 1_050,
      identity,
      control_tool_call_id: 'call-process-control',
      action: { type: 'write', input_bytes: 17, input: 'secret-value' },
      result: { status: 'accepted' },
    })).toThrow();

    expect(parseCommandExecutionAuditEvent({
      kind: 'process_action',
      occurred_at_ms: 1_051,
      identity,
      control_tool_call_id: 'call-process-poll',
      action: { type: 'poll', cursor: 0 },
      result: { status: 'running' },
    })).toMatchObject({
      action: { type: 'poll', cursor: 0 },
      result: { status: 'running' },
    });

    expect(() => parseCommandExecutionAuditEvent({
      kind: 'process_action',
      occurred_at_ms: 1_050,
      identity,
      control_tool_call_id: 'call-process-control-over-budget',
      action: { type: 'write', input_bytes: 64 * 1_024 + 1 },
      result: { status: 'accepted' },
    })).toThrow();
  });

  it('用户保护输入使用独立审计动作，只保存来源、byte 数和结果', () => {
    const event = parseCommandExecutionAuditEvent({
      kind: 'protected_input',
      occurred_at_ms: 1_060,
      identity,
      process_handle: 'command_process_00000000-0000-4000-8000-000000000030',
      attempt_id: 'command_protected_input_00000000-0000-4000-8000-000000000031',
      input_bytes: 14,
      result: { status: 'accepted' },
    });
    const envelope = project(event);

    expect(envelope.action).toBe('command.protected_input');
    expect(envelope.scope).toMatchObject({
      toolCallId: identity.origin_tool_call_id,
      toolName: 'shell',
    });
    expect(envelope.evidence?.[0]?.metadata).toEqual({
      source: 'user',
      process_handle: 'command_process_00000000-0000-4000-8000-000000000030',
      input_bytes: 14,
      result: { status: 'accepted' },
    });
    expect(JSON.stringify(envelope)).not.toContain('protected_input_ticket');
    expect(() => parseCommandExecutionAuditEvent({
      ...event,
      input: 'must-not-enter-audit',
    })).toThrow();
  });

  it('允许 child run 身份，并严格拒绝空的 Runtime 身份', () => {
    const childIdentity = CommandExecutionIdentitySchema.parse({
      ...identity,
      agent_run_id: 'subrun-child-audit',
      origin_tool_call_id: 'call-child-shell',
    });
    const envelope = project({
      kind: 'execution_started',
      occurred_at_ms: 1_020,
      identity: childIdentity,
      mode: 'pipe',
      runtime: runtimeSummary,
    });

    expect(envelope.runId).toBe('subrun-child-audit');
    expect(envelope.scope?.toolCallId).toBe('call-child-shell');
    expect(() => parseCommandExecutionAuditEvent({
      kind: 'process_action',
      occurred_at_ms: 1_050,
      identity,
      control_tool_call_id: ' ',
      action: { type: 'cancel' },
      result: { status: 'completed' },
    })).toThrow();
  });
});
