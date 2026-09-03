import { describe, expect, it } from 'vitest';
import type { ToolOutputReadResult } from '@app/schemas';
import { projectToolOutputReadPresentation } from './projectToolOutputReadPresentation';

const result: ToolOutputReadResult = {
  data: {
    blob_id: 'abcdef1234567890',
    start_offset: 4,
    end_offset_exclusive: 8,
    total_chars: 12,
    start_line: 2,
    end_line: 3,
    total_lines: 5,
    has_more: true,
    next_offset: 8,
    window_text: 'efgh',
  },
  observation: 'efgh',
};

describe('projectToolOutputReadPresentation', () => {
  it('loading 不解析尚不存在的 success result', () => {
    expect(projectToolOutputReadPresentation({
      sourceToolName: 'resource_read',
      uiKey: 'tool_output_read',
      args: { uri: 'tool_output://blobs/abcdef1234567890' },
      result: undefined,
      status: 'loading',
      phase: 'start',
    })).toMatchObject({
      data: { kind: 'lifecycle' },
      title: { text: { key: 'conversation.tool.output.continue' } },
    });
  });

  it('success strict parse 后一次生成正文与游标范围', () => {
    expect(projectToolOutputReadPresentation({
      sourceToolName: 'tool_output_read',
      uiKey: 'tool_output_read',
      args: { blob_id: 'abcdef1234567890', offset: 4 },
      result,
      status: 'success',
      phase: 'complete',
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        result: { window_text: 'efgh', next_offset: 8 },
        lineRange: '2-3 / 5 · 5-8 / 12',
      },
    });
  });

  it('历史 Resource wrapper 经独立 strict schema 投影到同一张卡', () => {
    expect(projectToolOutputReadPresentation({
      sourceToolName: 'resource_read',
      uiKey: 'tool_output_read',
      args: { uri: 'tool_output://blobs/abcdef1234567890' },
      result: {
        ...result,
        data: {
          uri: 'tool_output://blobs/abcdef1234567890',
          source: 'tool_output',
          ...result.data,
        },
      },
      status: 'success',
      phase: 'complete',
    })).toMatchObject({
      data: {
        kind: 'snapshot',
        result: { blob_id: 'abcdef1234567890', window_text: 'efgh' },
      },
    });
  });

  it('非法 success result 在 admission 边界失败', () => {
    expect(() => projectToolOutputReadPresentation({
      sourceToolName: 'tool_output_read',
      uiKey: 'tool_output_read',
      args: {},
      result: { data: { window_text: 'missing identity' } },
      status: 'success',
      phase: 'complete',
    })).toThrow();
  });
});
