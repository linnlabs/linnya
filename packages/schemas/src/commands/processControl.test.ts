import { describe, expect, it } from 'vitest';

import { parseCommandExecutionOwnerBinding } from './commandExecution';
import {
  MAX_PROCESS_INTERACTION_INPUT_BYTES,
  MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS,
  MAX_PROCESS_PTY_DIMENSION,
  parseProcessControlRejected,
  parseProcessControlRequest,
} from './processControl';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';
const PROCESS_HANDLE = 'command_process_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2c';

function createOwnerBinding(): Record<string, unknown> {
  return {
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
  };
}

function createControlRequest(action: unknown): Record<string, unknown> {
  return {
    protocol_version: 1,
    kind: 'process_control_request',
    process_handle: PROCESS_HANDLE,
    scope: {
      conversation_id: 'conversation-a',
      agent_run_id: 'run-a',
      control_tool_call_id: 'process-call-b',
      owner_generation_id: OWNER_GENERATION_ID,
    },
    action,
  };
}

describe('Command runtime wire contract', () => {
  it('把启动调用和后续控制调用保留为不同角色，同时共享 owner 归属', () => {
    const binding = parseCommandExecutionOwnerBinding(createOwnerBinding());
    const request = parseProcessControlRequest(createControlRequest({
      type: 'poll',
      cursor: 0,
    }));

    expect(binding.identity.origin_tool_call_id).toBe('shell-call-a');
    expect(request.scope.control_tool_call_id).toBe('process-call-b');
    expect(request.scope.owner_generation_id).toBe(binding.identity.owner_generation_id);
    expect(request.process_handle).toBe(binding.process_handle);
  });

  it('拒绝把 PID、Agent run 或 command execution identity 当作公开 handle', () => {
    for (const invalidHandle of ['1234', 'run-a', EXECUTION_ID]) {
      expect(() => parseProcessControlRequest({
        ...createControlRequest({ type: 'cancel' }),
        process_handle: invalidHandle,
      })).toThrow();
    }
  });

  it('拒绝旧协议和带有其他动作字段的模糊请求', () => {
    expect(() => parseProcessControlRequest({
      ...createControlRequest({ type: 'cancel' }),
      protocol_version: 2,
    })).toThrow();

    expect(() => parseProcessControlRequest(createControlRequest({
      type: 'cancel',
      input: 'unexpected',
    }))).toThrow();
  });

  it('保留 write、submit、EOF 和 cancel 的不同语义', () => {
    expect(() => parseProcessControlRequest(createControlRequest({
      type: 'write',
      input: '',
    }))).toThrow();

    expect(parseProcessControlRequest(createControlRequest({
      type: 'submit',
      input: '',
    })).action.type).toBe('submit');

    expect(parseProcessControlRequest(createControlRequest({
      type: 'eof',
    })).action.type).toBe('eof');

    expect(parseProcessControlRequest(createControlRequest({
      type: 'cancel',
    })).action.type).toBe('cancel');
  });

  it('按 UTF-8 byte 而不是 JavaScript 字符数限制单次交互输入', () => {
    const exactAscii = 'a'.repeat(MAX_PROCESS_INTERACTION_INPUT_BYTES);
    expect(parseProcessControlRequest(createControlRequest({
      type: 'write',
      input: exactAscii,
    })).action.type).toBe('write');
    expect(() => parseProcessControlRequest(createControlRequest({
      type: 'submit',
      input: `${exactAscii}a`,
    }))).toThrow();

    const chineseCharacter = '你';
    const bytesPerCharacter = new TextEncoder().encode(chineseCharacter).byteLength;
    const fittingCharacters = Math.floor(
      MAX_PROCESS_INTERACTION_INPUT_BYTES / bytesPerCharacter,
    );
    const fittingInput = chineseCharacter.repeat(fittingCharacters);
    expect(new TextEncoder().encode(fittingInput).byteLength)
      .toBeLessThanOrEqual(MAX_PROCESS_INTERACTION_INPUT_BYTES);
    expect(parseProcessControlRequest(createControlRequest({
      type: 'submit',
      input: fittingInput,
    })).action.type).toBe('submit');
    expect(() => parseProcessControlRequest(createControlRequest({
      type: 'submit',
      input: `${fittingInput}${chineseCharacter}`,
    }))).toThrow();
  });

  it('只接受两平台 PTY 都能表达的正数尺寸', () => {
    expect(parseProcessControlRequest(createControlRequest({
      type: 'resize',
      columns: MAX_PROCESS_PTY_DIMENSION,
      rows: MAX_PROCESS_PTY_DIMENSION,
    })).action.type).toBe('resize');
    for (const invalidDimension of [0, MAX_PROCESS_PTY_DIMENSION + 1]) {
      expect(() => parseProcessControlRequest(createControlRequest({
        type: 'resize',
        columns: invalidDimension,
        rows: 24,
      }))).toThrow();
      expect(() => parseProcessControlRequest(createControlRequest({
        type: 'resize',
        columns: 80,
        rows: invalidDimension,
      }))).toThrow();
    }
  });

  it('wait 只接受 Node timer 能可靠表达的正整数期限', () => {
    expect(parseProcessControlRequest(createControlRequest({
      type: 'wait',
      cursor: 0,
      wait_timeout_ms: MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS,
    })).action.type).toBe('wait');
    for (const invalidTimeout of [0, MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS + 1]) {
      expect(() => parseProcessControlRequest(createControlRequest({
        type: 'wait',
        cursor: 0,
        wait_timeout_ms: invalidTimeout,
      }))).toThrow();
    }
  });

  it('内部拒绝回复保留控制调用 identity，但不接受平台错误文案', () => {
    const request = parseProcessControlRequest(createControlRequest({ type: 'cancel' }));
    const rejected = parseProcessControlRejected({
      protocol_version: 1,
      kind: 'process_control_rejected',
      process_handle: request.process_handle,
      scope: request.scope,
      code: 'scope_mismatch',
    });

    expect(rejected.scope.control_tool_call_id).toBe('process-call-b');
    expect(() => parseProcessControlRejected({
      ...rejected,
      message: 'platform-specific process error',
    })).toThrow();
  });

  it('把输入预算耗尽作为稳定业务拒绝传回控制调用', () => {
    const request = parseProcessControlRequest(createControlRequest({
      type: 'submit',
      input: 'continue',
    }));
    const rejected = parseProcessControlRejected({
      protocol_version: 1,
      kind: 'process_control_rejected',
      process_handle: request.process_handle,
      scope: request.scope,
      code: 'input_budget_exceeded',
    });

    expect(rejected.code).toBe('input_budget_exceeded');
    expect(rejected.scope.control_tool_call_id).toBe('process-call-b');
  });

  it('把已释放终态 replay 表达为稳定过期结果', () => {
    const request = parseProcessControlRequest(createControlRequest({
      type: 'poll',
      cursor: 0,
    }));
    expect(parseProcessControlRejected({
      protocol_version: 1,
      kind: 'process_control_rejected',
      process_handle: request.process_handle,
      scope: request.scope,
      code: 'handle_expired',
    }).code).toBe('handle_expired');
  });
});
