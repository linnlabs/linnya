import { describe, expect, it } from 'vitest';

import {
  MAX_PROCESS_INTERACTION_INPUT_BYTES,
  MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS,
  MAX_PROCESS_PTY_DIMENSION,
} from './processControl';
import { parseProcessToolArguments } from './processTool';

const PROCESS_HANDLE = 'command_process_123e4567-e89b-42d3-a456-426614174000';

describe('ProcessToolArgumentsV1Schema', () => {
  it.each([
    { type: 'poll', cursor: 0 },
    { type: 'wait', cursor: 2, wait_timeout_ms: MAX_PROCESS_OUTPUT_WAIT_TIMEOUT_MS },
    { type: 'cancel' },
    { type: 'write', input: 'x'.repeat(MAX_PROCESS_INTERACTION_INPUT_BYTES) },
    { type: 'submit', input: '' },
    { type: 'eof' },
    { type: 'resize', columns: MAX_PROCESS_PTY_DIMENSION, rows: 1 },
  ])('接受 Agent 可执行的 $type 动作', action => {
    expect(parseProcessToolArguments({
      process_handle: PROCESS_HANDLE,
      action,
    })).toEqual({
      process_handle: PROCESS_HANDLE,
      action,
    });
  });

  it('拒绝不能证明为 opaque process handle 的字符串', () => {
    expect(() => parseProcessToolArguments({
      process_handle: 'run_1',
      action: { type: 'cancel' },
    })).toThrow();
  });

  it.each([
    ['conversation_id', 'conv_1'],
    ['agent_run_id', 'run_1'],
    ['owner_generation_id', 'command_owner_123e4567-e89b-42d3-a456-426614174000'],
    ['control_tool_call_id', 'call_1'],
    ['scope', {}],
  ])('拒绝 Agent 注入内部字段 %s', (field, value) => {
    expect(() => parseProcessToolArguments({
      process_handle: PROCESS_HANDLE,
      action: { type: 'cancel' },
      [field]: value,
    })).toThrow();
  });

  it('复用公共 action 的输入 byte 和尺寸边界', () => {
    expect(() => parseProcessToolArguments({
      process_handle: PROCESS_HANDLE,
      action: {
        type: 'write',
        input: 'x'.repeat(MAX_PROCESS_INTERACTION_INPUT_BYTES + 1),
      },
    })).toThrow();
    expect(() => parseProcessToolArguments({
      process_handle: PROCESS_HANDLE,
      action: {
        type: 'resize',
        columns: MAX_PROCESS_PTY_DIMENSION + 1,
        rows: 1,
      },
    })).toThrow();
  });

  it.each([
    { type: 'poll' },
    { type: 'poll', cursor: 0, wait_timeout_ms: 1 },
    { type: 'wait', cursor: 0 },
    { type: 'cancel', cursor: 0 },
    { type: 'write', input: 'hello', rows: 20 },
    { type: 'eof', input: '' },
    { type: 'resize', columns: 80 },
  ])('由 strict Zod 合同拒绝字段组合不匹配的 $type 动作', action => {
    expect(() => parseProcessToolArguments({
      process_handle: PROCESS_HANDLE,
      action,
    })).toThrow();
  });
});
