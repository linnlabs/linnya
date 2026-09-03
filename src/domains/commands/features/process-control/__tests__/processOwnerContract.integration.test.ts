import { describe, expect, it } from 'vitest';
import {
  CommandOwnerGenerationIdSchema,
  CommandProcessHandleSchema,
  parseCommandExecutionOwnerBinding,
  parseCommandExecutionTerminal,
  parseProcessControlRequest,
  type CommandExecutionIdentity,
  type CommandExecutionTerminalV1,
} from '@app/schemas/commands';

import type {
  OwnedProcessHandle,
  ProcessOwnerSnapshot,
} from '../definitions/processOwnerState';
import { acceptProcessAction } from '../functions/acceptProcessAction';
import { advanceProcessTerminalState } from '../functions/advanceProcessTerminalState';
import { createOwnerEndedBeforeStartTerminal } from '../functions/createOwnerEndedBeforeStartTerminal';
import { evaluateCommandExecutionStopRelease } from '../functions/evaluateCommandExecutionStopRelease';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OTHER_EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2d';
const OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';
const OTHER_OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2e';
const PROCESS_HANDLE = 'command_process_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2c';
const UNKNOWN_PROCESS_HANDLE = 'command_process_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2f';

function createIdentity(): CommandExecutionIdentity {
  return parseCommandExecutionOwnerBinding({
    protocol_version: 1,
    kind: 'command_execution_owner_binding',
    identity: {
      conversation_id: 'conversation-a',
      agent_run_id: 'run-a',
      origin_tool_call_id: 'shell-call-a',
      command_execution_id: EXECUTION_ID,
      owner_generation_id: OWNER_GENERATION_ID,
      created_at_ms: 1_785_499_200_000,
    },
    process_handle: PROCESS_HANDLE,
    mode: 'pipe',
  }).identity;
}

function createTerminal(overrides: {
  readonly identity?: CommandExecutionIdentity;
  readonly terminationCause?: 'natural_exit' | 'user_cancelled' | 'hard_timeout' | 'owner_ended';
  readonly exitCode?: number;
} = {}): CommandExecutionTerminalV1 {
  return parseCommandExecutionTerminal({
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: overrides.identity ?? createIdentity(),
    settled_at_ms: 1_785_499_201_000,
    outcome: 'execution_ended',
    termination_cause: overrides.terminationCause ?? 'natural_exit',
    process_exit: {
      status: 'observed',
      exit_code: overrides.exitCode ?? 0,
      signal: null,
    },
    output_drain: { status: 'complete' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'succeeded' },
  });
}

function createRequest(
  action: unknown,
  overrides: {
    readonly processHandle?: string;
    readonly conversationId?: string;
    readonly ownerGenerationId?: string;
  } = {},
) {
  return parseProcessControlRequest({
    protocol_version: 1,
    kind: 'process_control_request',
    process_handle: overrides.processHandle ?? PROCESS_HANDLE,
    scope: {
      conversation_id: overrides.conversationId ?? 'conversation-a',
      agent_run_id: 'run-a',
      control_tool_call_id: 'process-call-a',
      owner_generation_id: overrides.ownerGenerationId ?? OWNER_GENERATION_ID,
    },
    action,
  });
}

function createOwner(
  lifecycle: ProcessOwnerSnapshot['lifecycle'] = 'active',
): ProcessOwnerSnapshot {
  return {
    generationId: CommandOwnerGenerationIdSchema.parse(OWNER_GENERATION_ID),
    lifecycle,
  };
}

function createTarget(
  state: OwnedProcessHandle['state'] = 'running',
): OwnedProcessHandle {
  const base = {
    processHandle: CommandProcessHandleSchema.parse(PROCESS_HANDLE),
    identity: createIdentity(),
  };
  if (state === 'running' || state === 'expired') return { ...base, state };
  return { ...base, state, terminal: createTerminal() };
}

describe('Process owner contract', () => {
  it('只接受当前 owner、当前对话和当前 Agent run 共同拥有的 handle', () => {
    expect(acceptProcessAction({
      owner: createOwner(),
      request: createRequest({ type: 'poll', cursor: 0 }),
      target: createTarget(),
    }).status).toBe('accepted');

    expect(acceptProcessAction({
      owner: createOwner(),
      request: createRequest(
        { type: 'poll', cursor: 0 },
        { processHandle: UNKNOWN_PROCESS_HANDLE },
      ),
      target: undefined,
    })).toEqual({ status: 'rejected', code: 'unknown_handle' });

    expect(acceptProcessAction({
      owner: createOwner(),
      request: createRequest(
        { type: 'poll', cursor: 0 },
        { conversationId: 'conversation-b' },
      ),
      target: createTarget(),
    })).toEqual({ status: 'rejected', code: 'scope_mismatch' });

    expect(acceptProcessAction({
      owner: createOwner(),
      request: createRequest(
        { type: 'poll', cursor: 0 },
        { ownerGenerationId: OTHER_OWNER_GENERATION_ID },
      ),
      target: createTarget(),
    })).toEqual({ status: 'rejected', code: 'scope_mismatch' });
  });

  it('owner ending 和 ended 是明确业务状态，不伪装成未知 handle', () => {
    const request = createRequest({ type: 'poll', cursor: 0 });

    expect(acceptProcessAction({
      owner: createOwner('ending'),
      request,
      target: createTarget(),
    })).toEqual({ status: 'rejected', code: 'owner_ending' });

    expect(acceptProcessAction({
      owner: createOwner('ended'),
      request,
      target: undefined,
    })).toEqual({ status: 'rejected', code: 'owner_ended' });
  });

  it('终态 handle 允许 poll/wait 幂等读取，但拒绝输入、resize 和重复取消', () => {
    const target = createTarget('terminal');

    for (const action of [
      { type: 'poll', cursor: 0 },
      { type: 'wait', cursor: 0, wait_timeout_ms: 100 },
    ]) {
      const result = acceptProcessAction({
        owner: createOwner(),
        request: createRequest(action),
        target,
      });
      expect(result.status).toBe('terminal_replay');
    }

    for (const action of [
      { type: 'write', input: 'answer' },
      { type: 'submit', input: 'answer' },
      { type: 'eof' },
      { type: 'resize', columns: 120, rows: 30 },
      { type: 'cancel' },
    ]) {
      expect(acceptProcessAction({
        owner: createOwner(),
        request: createRequest(action),
        target,
      })).toEqual({ status: 'rejected', code: 'incompatible_state' });
    }
  });

  it('近期过期 handle 返回明确结果，不伪装成未知或仍可控制', () => {
    for (const action of [
      { type: 'poll', cursor: 0 },
      { type: 'wait', cursor: 0, wait_timeout_ms: 100 },
      { type: 'cancel' },
      { type: 'write', input: 'answer' },
    ]) {
      expect(acceptProcessAction({
        owner: createOwner(),
        request: createRequest(action),
        target: createTarget('expired'),
      })).toEqual({ status: 'rejected', code: 'handle_expired' });
    }
  });

  it('第一个合法终态获胜，timeout 后迟到的自然退出不能覆盖主原因', () => {
    const expectedIdentity = createIdentity();
    const timeout = createTerminal({
      identity: expectedIdentity,
      terminationCause: 'hard_timeout',
      exitCode: 137,
    });
    const naturalExit = createTerminal({
      identity: expectedIdentity,
      terminationCause: 'natural_exit',
      exitCode: 0,
    });

    const accepted = advanceProcessTerminalState({
      expectedIdentity,
      currentTerminal: undefined,
      candidate: timeout,
    });
    expect(accepted).toEqual({ status: 'accepted', terminal: timeout });

    expect(advanceProcessTerminalState({
      expectedIdentity,
      currentTerminal: timeout,
      candidate: naturalExit,
    })).toEqual({
      status: 'ignored',
      reason: 'already_terminal',
      terminal: timeout,
    });
  });

  it('停止后的删除屏障只接受未启动或整树与资源都已可信收口的终态', () => {
    const identity = createIdentity();
    const notStarted = createOwnerEndedBeforeStartTerminal({
      identity,
      settledAtMs: 1_785_499_201_000,
    });
    expect(evaluateCommandExecutionStopRelease(notStarted)).toEqual({ status: 'releasable' });

    const stopped = parseCommandExecutionTerminal({
      ...createTerminal({
        identity,
        terminationCause: 'owner_ended',
      }),
      tree_cleanup: { status: 'succeeded' },
    });
    expect(evaluateCommandExecutionStopRelease(stopped)).toEqual({ status: 'releasable' });

    const incompleteOutput = parseCommandExecutionTerminal({
      ...stopped,
      output_drain: {
        status: 'failed',
        code: 'output_drain_failed',
        reason: 'drain_deadline_exceeded',
      },
    });
    expect(evaluateCommandExecutionStopRelease(incompleteOutput)).toEqual({
      status: 'releasable',
    });

    const treeFailed = parseCommandExecutionTerminal({
      ...stopped,
      tree_cleanup: { status: 'failed', code: 'tree_cleanup_failed' },
    });
    expect(evaluateCommandExecutionStopRelease(treeFailed)).toEqual({
      status: 'blocked',
      reason: 'tree_cleanup_failed',
    });

    const resourceFailed = parseCommandExecutionTerminal({
      ...stopped,
      resource_release: { status: 'failed', code: 'resource_release_failed' },
    });
    expect(evaluateCommandExecutionStopRelease(resourceFailed)).toEqual({
      status: 'blocked',
      reason: 'resource_release_failed',
    });
  });

  it('旧 generation 和其他 execution 的迟到回调不能进入当前 owner', () => {
    const expectedIdentity = createIdentity();
    const staleGenerationIdentity = {
      ...expectedIdentity,
      owner_generation_id: CommandOwnerGenerationIdSchema.parse(OTHER_OWNER_GENERATION_ID),
    };
    const otherExecutionIdentity = {
      ...expectedIdentity,
      command_execution_id: parseCommandExecutionOwnerBinding({
        protocol_version: 1,
        kind: 'command_execution_owner_binding',
        identity: {
          ...expectedIdentity,
          command_execution_id: OTHER_EXECUTION_ID,
        },
        process_handle: PROCESS_HANDLE,
        mode: 'pipe',
      }).identity.command_execution_id,
    };

    expect(advanceProcessTerminalState({
      expectedIdentity,
      currentTerminal: undefined,
      candidate: createTerminal({ identity: staleGenerationIdentity }),
    })).toEqual({ status: 'ignored', reason: 'owner_generation_mismatch' });

    expect(advanceProcessTerminalState({
      expectedIdentity,
      currentTerminal: undefined,
      candidate: createTerminal({ identity: otherExecutionIdentity }),
    })).toEqual({ status: 'ignored', reason: 'execution_identity_mismatch' });
  });
});
