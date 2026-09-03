import { describe, expect, it } from 'vitest';

import { parseCommandExecutionTerminal } from './commandOutcome';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';

function createIdentity() {
  return {
    conversation_id: 'conversation-a',
    agent_run_id: 'run-a',
    origin_tool_call_id: 'shell-call-a',
    command_execution_id: EXECUTION_ID,
    owner_generation_id: OWNER_GENERATION_ID,
    created_at_ms: 1_785_499_200_000,
  };
}

function createNaturalExit(exitCode: number) {
  return {
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: createIdentity(),
    settled_at_ms: 1_785_499_201_000,
    outcome: 'execution_ended',
    termination_cause: 'natural_exit',
    process_exit: {
      status: 'observed',
      exit_code: exitCode,
      signal: null,
    },
    output_drain: { status: 'complete' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'succeeded' },
  };
}

describe('Command execution terminal wire contract', () => {
  it.each([124, 130])('保留自然退出码 %s，不把品牌退出码反推为超时或取消', exitCode => {
    const terminal = parseCommandExecutionTerminal(createNaturalExit(exitCode));

    expect(terminal.outcome).toBe('execution_ended');
    if (terminal.outcome !== 'execution_ended') {
      throw new Error('自然退出必须解析为 execution_ended');
    }
    expect(terminal.termination_cause).toBe('natural_exit');
    expect(terminal.process_exit).toEqual({
      status: 'observed',
      exit_code: exitCode,
      signal: null,
    });
  });

  it('同时保留 hard timeout 主原因、原始退出事实和收树失败', () => {
    const terminal = parseCommandExecutionTerminal({
      ...createNaturalExit(137),
      termination_cause: 'hard_timeout',
      tree_cleanup: {
        status: 'failed',
        code: 'tree_cleanup_failed',
      },
    });

    expect(terminal.outcome).toBe('execution_ended');
    if (terminal.outcome !== 'execution_ended') {
      throw new Error('hard timeout 必须解析为 execution_ended');
    }
    expect(terminal.termination_cause).toBe('hard_timeout');
    expect(terminal.tree_cleanup).toEqual({
      status: 'failed',
      code: 'tree_cleanup_failed',
    });
  });

  it('启动前失败不能伪造进程退出、输出排空或资源清理', () => {
    const terminal = parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity: createIdentity(),
      settled_at_ms: 1_785_499_201_000,
      outcome: 'runtime_failure',
      failure: { code: 'launch_failed' },
      process_exit: { status: 'not_started' },
      output_drain: { status: 'not_started' },
      tree_cleanup: { status: 'not_required' },
      resource_release: { status: 'not_required' },
    });

    expect(terminal.outcome).toBe('runtime_failure');
    expect(terminal.process_exit.status).toBe('not_started');

    expect(() => parseCommandExecutionTerminal({
      ...terminal,
      output_drain: { status: 'complete' },
    })).toThrow('a command without a process cannot report output drain completion');
  });

  it('自然完成必须来自真实退出事实，且 wire 不接受多余字段', () => {
    expect(() => parseCommandExecutionTerminal({
      ...createNaturalExit(0),
      process_exit: {
        status: 'unavailable',
        reason: 'platform_not_reported',
      },
    })).toThrow('natural exit requires an observed process exit fact');

    expect(() => parseCommandExecutionTerminal({
      ...createNaturalExit(0),
      output_drain: { status: 'not_started' },
    })).toThrow('natural exit requires output drain completion or an explicit drain failure');

    expect(parseCommandExecutionTerminal({
      ...createNaturalExit(0),
      output_drain: {
        status: 'failed',
        code: 'output_drain_failed',
        reason: 'stream_read_failed',
      },
    }).output_drain.status).toBe('failed');

    expect(() => parseCommandExecutionTerminal({
      ...createNaturalExit(0),
      guessed_success: true,
    })).toThrow();
  });

  it('进程树和运行时资源可以同时记录失败，且墙上时间回拨不改变真实终态', () => {
    const terminal = parseCommandExecutionTerminal({
      ...createNaturalExit(0),
      settled_at_ms: createIdentity().created_at_ms - 1_000,
      tree_cleanup: {
        status: 'failed',
        code: 'tree_cleanup_failed',
      },
      resource_release: {
        status: 'failed',
        code: 'resource_release_failed',
      },
    });

    expect(terminal.tree_cleanup.status).toBe('failed');
    expect(terminal.resource_release.status).toBe('failed');
  });

  it('启动前失败和运行中 runtime 丢失不能互相伪装', () => {
    expect(() => parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity: createIdentity(),
      settled_at_ms: 1_785_499_201_000,
      outcome: 'runtime_failure',
      failure: { code: 'launch_failed' },
      process_exit: {
        status: 'observed',
        exit_code: 1,
        signal: null,
      },
      output_drain: { status: 'complete' },
      tree_cleanup: { status: 'not_required' },
      resource_release: { status: 'succeeded' },
    })).toThrow('a pre-launch runtime failure cannot report a started process');

    expect(() => parseCommandExecutionTerminal({
      protocol_version: 1,
      kind: 'command_execution_terminal',
      identity: createIdentity(),
      settled_at_ms: 1_785_499_201_000,
      outcome: 'runtime_failure',
      failure: { code: 'runtime_lost' },
      process_exit: { status: 'not_started' },
      output_drain: { status: 'not_started' },
      tree_cleanup: { status: 'not_required' },
      resource_release: { status: 'not_required' },
    })).toThrow('runtime loss cannot claim that no process was started');
  });
});
