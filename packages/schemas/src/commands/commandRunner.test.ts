import { describe, expect, it } from 'vitest';

import {
  parseCommandRunnerEvent,
  parseCommandRunnerRequest,
} from './commandRunner';
import {
  parseCommandLaunchSnapshot,
  parsePipeCommandLaunchSnapshot,
  parsePtyCommandLaunchSnapshot,
} from './commandLaunch';
import { MAX_COMMAND_OUTPUT_EVENT_BYTES } from './commandOutput';
import { parseShellToolArguments } from './shellTool';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OTHER_EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';
const OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2c';

function createIdentity(commandExecutionId = EXECUTION_ID) {
  return {
    conversation_id: 'conversation-a',
    agent_run_id: 'run-a',
    origin_tool_call_id: 'shell-call-a',
    command_execution_id: commandExecutionId,
    owner_generation_id: OWNER_GENERATION_ID,
    created_at_ms: 1_785_499_200_000,
  };
}

function createPermission({
  identity = createIdentity(),
  baseLevel = 'read_only',
  effectiveLevel = 'read_only',
  grantSource = 'global_setting',
  internalDataAccess = 'denied',
} = {}) {
  return {
    protocol_version: 1,
    kind: 'command_permission_snapshot',
    identity,
    base_level: baseLevel,
    effective_level: effectiveLevel,
    grant_source: grantSource,
    internal_data_access: internalDataAccess,
  };
}

function createLaunch(overrides: Record<string, unknown> = {}) {
  const identity = createIdentity();
  return {
    protocol_version: 1,
    kind: 'pipe_command_launch_snapshot',
    conversation_root: '/tmp/linnya conversation',
    proposal: {
      protocol_version: 1,
      kind: 'shell_command_proposal',
      identity,
      command: 'printf "中文 😀\\n"',
      cwd: '/tmp/linnya conversation',
      permission: createPermission(),
    },
    permission: createPermission({
      effectiveLevel: 'standard',
      grantSource: 'allow_once',
    }),
    mode: 'pipe',
    shell: {
      platform: 'macos',
      shell_semantics_id: 'zsh',
      shell_version: '5.9',
      snapshot_revision: 'login-environment-a',
      output_text_encoding: 'utf-8',
      command_invocation_profile_id: 'plain-v1',
      executable_path: '/bin/zsh',
      argv_prefix: ['-f', '-c'],
    },
    environment: {
      revision: 'login-environment-a',
      entries: { PATH: '/usr/bin:/bin' },
    },
    stdin: 'closed',
    lifecycle_policy: 'terminate_with_run',
    hard_timeout_ms: 180_000,
    ...overrides,
  };
}

function createPtyLaunch(overrides: Record<string, unknown> = {}) {
  return {
    ...createLaunch(),
    kind: 'pty_command_launch_snapshot',
    mode: 'pty',
    stdin: 'pty',
    terminal_size: { columns: 80, rows: 24 },
    ...overrides,
  };
}

function createNaturalTerminal() {
  return {
    protocol_version: 1,
    kind: 'command_execution_terminal',
    identity: createIdentity(),
    settled_at_ms: 1_785_499_201_000,
    outcome: 'execution_ended',
    termination_cause: 'natural_exit',
    process_exit: {
      status: 'observed',
      exit_code: 7,
      signal: null,
    },
    output_drain: { status: 'complete' },
    tree_cleanup: { status: 'not_required' },
    resource_release: { status: 'succeeded' },
  };
}

function createCompleteOutputSources() {
  return {
    mode: 'pipe',
    stdout: {
      source_completion: 'complete',
      next_sequence: 1,
      observed_bytes: 5,
    },
    stderr: {
      source_completion: 'complete',
      next_sequence: 0,
      observed_bytes: 0,
    },
  };
}

function createCompletePtyOutputSource() {
  return {
    mode: 'pty',
    terminal: {
      source_completion: 'complete',
      next_sequence: 1,
      observed_bytes: 5,
    },
  };
}

describe('pipe command launch contract', () => {
  it('保留已审批的权限和原始命令，并明确关闭普通进程 stdin', () => {
    const launch = parsePipeCommandLaunchSnapshot(createLaunch());

    expect(launch.proposal.command).toBe('printf "中文 😀\\n"');
    expect(launch.conversation_root).toBe('/tmp/linnya conversation');
    expect(launch.permission.effective_level).toBe('standard');
    expect(launch.shell.output_text_encoding).toBe('utf-8');
    expect(launch.stdin).toBe('closed');
  });

  it('要求启动前冻结严格编码，不接受缺省或自动猜测', () => {
    const launch = createLaunch();

    expect(() => parsePipeCommandLaunchSnapshot(createLaunch({
      shell: { ...launch.shell, output_text_encoding: undefined },
    }))).toThrow();
    expect(() => parsePipeCommandLaunchSnapshot(createLaunch({
      shell: { ...launch.shell, output_text_encoding: 'auto' },
    }))).toThrow();
  });

  it('拒绝把其他 execution 的权限或改变全局选项的权限拼进启动快照', () => {
    expect(() => parsePipeCommandLaunchSnapshot(createLaunch({
      permission: createPermission({
        identity: createIdentity(OTHER_EXECUTION_ID),
        effectiveLevel: 'standard',
        grantSource: 'allow_once',
      }),
    }))).toThrow('launch permission must belong to the same command execution');

    expect(() => parsePipeCommandLaunchSnapshot(createLaunch({
      permission: createPermission({ baseLevel: 'standard' }),
    }))).toThrow('authorization must not replace the selected permission level');

    expect(() => parsePipeCommandLaunchSnapshot(createLaunch({
      permission: createPermission({ internalDataAccess: 'allowed' }),
    }))).toThrow('authorization must not replace the internal-data setting');
  });

  it('不让 initial wait 混入会改变命令命运的 runner launch', () => {
    expect(() => parsePipeCommandLaunchSnapshot(createLaunch({
      initial_wait_ms: 10_000,
    }))).toThrow();
  });
});

describe('pipe 与 PTY 启动能力边界', () => {
  it('用 kind 判别两种启动，并冻结 PTY 初始尺寸', () => {
    const pipe = parseCommandLaunchSnapshot(createLaunch());
    const pty = parsePtyCommandLaunchSnapshot(createPtyLaunch());

    expect(pipe.mode).toBe('pipe');
    expect(pty.mode).toBe('pty');
    expect(pty.stdin).toBe('pty');
    expect(pty.terminal_size).toEqual({ columns: 80, rows: 24 });
  });

  it('拒绝把 PTY stdin 或尺寸混进旧 pipe frame，也拒绝缺少尺寸的 PTY', () => {
    expect(() => parsePipeCommandLaunchSnapshot(createLaunch({
      stdin: 'pty',
      terminal_size: { columns: 80, rows: 24 },
    }))).toThrow();
    expect(() => parsePtyCommandLaunchSnapshot(createPtyLaunch({
      terminal_size: undefined,
    }))).toThrow();
    expect(() => parsePtyCommandLaunchSnapshot(createPtyLaunch({
      mode: 'pipe',
    }))).toThrow();
  });
});

describe('shell Agent input boundary', () => {
  it('只接收命令、单次 cwd 和首次等待，不让 Agent 注入内部执行事实', () => {
    expect(parseShellToolArguments({
      command: 'pwd',
      cwd: '/tmp/linnya conversation',
      initial_wait_ms: 10_000,
    })).toEqual({
      command: 'pwd',
      cwd: '/tmp/linnya conversation',
      initial_wait_ms: 10_000,
    });

    expect(() => parseShellToolArguments({
      command: 'pwd',
      conversation_id: 'conversation-a',
      process_handle: 'command_process_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2d',
      permission: 'full_access',
    })).toThrow();
  });

  it('只有显式 interactive 才请求本次 run 的 PTY，缺省输入保持旧形状', () => {
    expect(parseShellToolArguments({ command: 'pwd' })).toEqual({ command: 'pwd' });
    expect(parseShellToolArguments({ command: 'pwd', interactive: true }))
      .toEqual({ command: 'pwd', interactive: true });
    expect(() => parseShellToolArguments({ command: 'pwd', interactive: 'yes' })).toThrow();
  });

  it('只接受布尔写入声明，不允许 Agent 直接指定最终权限档', () => {
    expect(parseShellToolArguments({ command: 'touch result.txt', requires_write_access: true }))
      .toEqual({ command: 'touch result.txt', requires_write_access: true });
    expect(() => parseShellToolArguments({
      command: 'touch result.txt',
      requires_write_access: 'standard',
    })).toThrow();
  });

  it('首次等待只接受已验证的 host 等待区间', () => {
    expect(parseShellToolArguments({ command: 'pwd', initial_wait_ms: 250 }))
      .toMatchObject({ initial_wait_ms: 250 });
    expect(parseShellToolArguments({ command: 'pwd', initial_wait_ms: 30_000 }))
      .toMatchObject({ initial_wait_ms: 30_000 });
    expect(() => parseShellToolArguments({ command: 'pwd', initial_wait_ms: 249 }))
      .toThrow();
    expect(() => parseShellToolArguments({ command: 'pwd', initial_wait_ms: 30_001 }))
      .toThrow();
  });

  it('单条 hard timeout 使用秒输入，并拒绝非整数或产品上限外的值', () => {
    expect(parseShellToolArguments({ command: 'pwd', hard_timeout_seconds: 1 }))
      .toMatchObject({ hard_timeout_seconds: 1 });
    expect(parseShellToolArguments({ command: 'pwd', hard_timeout_seconds: 600 }))
      .toMatchObject({ hard_timeout_seconds: 600 });
    expect(() => parseShellToolArguments({ command: 'pwd', hard_timeout_seconds: 0 }))
      .toThrow();
    expect(() => parseShellToolArguments({ command: 'pwd', hard_timeout_seconds: 601 }))
      .toThrow();
    expect(() => parseShellToolArguments({ command: 'pwd', hard_timeout_seconds: 1.5 }))
      .toThrow();
  });
});

describe('disposable command runner wire contract', () => {
  it('使用真实 byte 事件且拒绝默认 JSON IPC 产生的普通对象', () => {
    const bytes = Uint8Array.from([0x00, 0xff, 0xe4, 0xb8, 0xad]);
    const event = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_output',
      identity: createIdentity(),
      channel: 'stdout',
      sequence: 0,
      bytes,
    });
    expect(event.kind).toBe('command_runner_output');
    if (event.kind !== 'command_runner_output') {
      throw new Error('输出事件必须保持 command_runner_output');
    }
    expect(event.bytes).toEqual(bytes);

    expect(() => parseCommandRunnerEvent({
      ...event,
      bytes: { 0: 0, 1: 255 },
    })).toThrow('command output must be a non-empty Uint8Array');
    expect(() => parseCommandRunnerEvent({
      ...event,
      bytes: new Uint8Array(),
    })).toThrow('command output must be a non-empty Uint8Array');
    expect(() => parseCommandRunnerEvent({
      ...event,
      bytes: new Uint8Array(MAX_COMMAND_OUTPUT_EVENT_BYTES + 1),
    })).toThrow(`no larger than ${MAX_COMMAND_OUTPUT_EVENT_BYTES} bytes`);
  });

  it('保留旧 pipe 输出帧，并用独立 PTY 帧表达 terminal 单流', () => {
    const legacyPipeFrame = {
      protocol_version: 1,
      kind: 'command_runner_output',
      identity: createIdentity(),
      channel: 'stdout',
      sequence: 0,
      bytes: Uint8Array.from([0x70, 0x69, 0x70, 0x65]),
    };
    expect(parseCommandRunnerEvent(legacyPipeFrame)).toEqual(legacyPipeFrame);

    const ptyFrame = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_pty_output',
      identity: createIdentity(),
      channel: 'terminal',
      sequence: 0,
      bytes: Uint8Array.from([0x1b, 0x5b, 0x32, 0x4a]),
    });
    expect(ptyFrame.kind).toBe('command_runner_pty_output');

    expect(() => parseCommandRunnerEvent({
      ...legacyPipeFrame,
      channel: 'terminal',
    })).toThrow();
    expect(() => parseCommandRunnerEvent({
      ...ptyFrame,
      channel: 'stderr',
    })).toThrow();
  });

  it('用 interaction id 关联真实 runner 接纳结果，且不接收观察或取消动作', () => {
    const request = parseCommandRunnerRequest({
      protocol_version: 1,
      kind: 'command_runner_interaction',
      identity: createIdentity(),
      interaction_id: 3,
      action: { type: 'submit', input: '确认' },
    });
    expect(request.kind).toBe('command_runner_interaction');

    const accepted = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_interaction_result',
      identity: createIdentity(),
      interaction_id: 3,
      result: { status: 'accepted' },
    });
    expect(accepted.kind).toBe('command_runner_interaction_result');

    const budgetRejected = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_interaction_result',
      identity: createIdentity(),
      interaction_id: 4,
      result: { status: 'rejected', code: 'input_budget_exceeded' },
    });
    expect(budgetRejected.kind).toBe('command_runner_interaction_result');

    for (const action of [
      { type: 'poll', cursor: 0 },
      { type: 'cancel' },
    ]) {
      expect(() => parseCommandRunnerRequest({
        ...request,
        action,
      })).toThrow();
    }
    expect(() => parseCommandRunnerEvent({
      ...budgetRejected,
      interaction_id: -1,
    })).toThrow();
    expect(() => parseCommandRunnerEvent({
      ...budgetRejected,
      result: { status: 'rejected', code: 'scope_mismatch' },
    })).toThrow();
  });

  it('stop 只能声明 owner 发起的原因，自然退出只能来自 runner 终态', () => {
    expect(parseCommandRunnerRequest({
      protocol_version: 1,
      kind: 'command_runner_stop',
      identity: createIdentity(),
      cause: 'hard_timeout',
    }).kind).toBe('command_runner_stop');

    expect(() => parseCommandRunnerRequest({
      protocol_version: 1,
      kind: 'command_runner_stop',
      identity: createIdentity(),
      cause: 'natural_exit',
    })).toThrow();

    const terminal = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_terminal',
      terminal: createNaturalTerminal(),
      output_sources: createCompleteOutputSources(),
    });
    expect(terminal.kind).toBe('command_runner_terminal');

    expect(() => parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_terminal',
      terminal: createNaturalTerminal(),
      output_sources: {
        ...createCompleteOutputSources(),
        stdout: {
          source_completion: 'interrupted',
          next_sequence: 1,
          observed_bytes: 9,
          interruption_reason: 'runner_output_queue_overloaded',
        },
      },
    })).toThrow('complete output drain requires both runner output sources to be complete');
  });

  it('终态来源保持 pipe 双流与 PTY terminal 单流互斥', () => {
    const ptyTerminal = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_terminal',
      terminal: createNaturalTerminal(),
      output_sources: createCompletePtyOutputSource(),
    });
    expect(ptyTerminal.kind).toBe('command_runner_terminal');

    expect(() => parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_terminal',
      terminal: createNaturalTerminal(),
      output_sources: {
        ...createCompletePtyOutputSource(),
        stdout: createCompleteOutputSources().stdout,
      },
    })).toThrow();
    expect(() => parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_terminal',
      terminal: createNaturalTerminal(),
      output_sources: {
        ...createCompleteOutputSources(),
        terminal: createCompletePtyOutputSource().terminal,
      },
    })).toThrow();
  });

  it('启动回滚可以报告已创建进程，但输出观察尚未开始', () => {
    const event = parseCommandRunnerEvent({
      protocol_version: 1,
      kind: 'command_runner_terminal',
      terminal: {
        protocol_version: 1,
        kind: 'command_execution_terminal',
        identity: createIdentity(),
        settled_at_ms: 1_785_499_201_000,
        outcome: 'runtime_failure',
        failure: { code: 'process_owner_unavailable' },
        process_exit: {
          status: 'unavailable',
          reason: 'platform_not_reported',
        },
        output_drain: { status: 'not_started' },
        tree_cleanup: { status: 'succeeded' },
        resource_release: { status: 'succeeded' },
      },
    });

    expect(event.kind).toBe('command_runner_terminal');
  });

  it('start 接受已冻结的 pipe 或 PTY launch，但不接收 handle 或 PID', () => {
    const request = parseCommandRunnerRequest({
      protocol_version: 1,
      kind: 'command_runner_start',
      launch: createLaunch(),
    });
    expect(request.kind).toBe('command_runner_start');

    const ptyRequest = parseCommandRunnerRequest({
      protocol_version: 1,
      kind: 'command_runner_start',
      launch: createPtyLaunch(),
    });
    expect(ptyRequest.kind).toBe('command_runner_start');

    expect(() => parseCommandRunnerRequest({
      ...request,
      process_handle: 'command_process_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2d',
      pid: 1234,
    })).toThrow();
  });
});
