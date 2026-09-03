import { describe, it, expect } from 'vitest';
import { ToolMessageService } from '../toolMessageService';
import type { ToolCallPatch } from '../toolEventAdapter';
describe('ToolMessageService.buildContentFromPatch', () => {
  it('tool_output 应只使用 canonical observation 作为消息正文', () => {
    const patch: ToolCallPatch = {
      type: 'tool_output',
      phase: 'complete',
      toolName: 'test_tool',
      status: 'success',
      observation: 'text output',
      data: { x: 1 },
    };
    const res = ToolMessageService.buildContentFromPatch(patch);
    expect(res).toBe('text output');
  });

  it('缺少 observation 时不得把 data 序列化成消息正文', () => {
    const patch: ToolCallPatch = {
      type: 'tool_output',
      phase: 'complete',
      toolName: 'test_tool',
      status: 'success',
      data: { x: 1 },
    };
    expect(ToolMessageService.buildContentFromPatch(patch)).toBeUndefined();
  });

  it('已结算交互不应覆盖工具卡原有正文', () => {
    const patch: ToolCallPatch = {
      type: 'tool_output',
      phase: 'complete',
      toolName: 'test_tool',
      status: 'success',
      observation: 'submitted response',
      data: { accepted: true },
      eventMetadata: { interaction: { status: 'submitted' } },
    };
    expect(ToolMessageService.buildContentFromPatch(patch)).toBeUndefined();
  });
});
