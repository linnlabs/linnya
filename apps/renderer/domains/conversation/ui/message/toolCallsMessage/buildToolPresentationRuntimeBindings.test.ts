import { describe, expect, it } from 'vitest';
import { buildToolPresentationRuntimeBindings } from './buildToolPresentationRuntimeBindings';

const lazySource = {
  conversationId: 'conversation-1',
  parentToolCallId: 'tool-1',
  kinds: ['tool_process' as const],
};

describe('buildToolPresentationRuntimeBindings', () => {
  it('声明 subrun trace 后同时透传 live 与 durable replay 事实', () => {
    const trace = { 'subrun-1': { subrun_id: 'subrun-1', events: [] } };
    expect(buildToolPresentationRuntimeBindings({
      capabilities: { subrunTrace: true },
      conversationId: 'conversation-1',
      parentToolCallId: 'tool-1',
      subrunTrace: trace,
      subrunTraceVersion: 3,
      historicalSubrunTraceSource: lazySource,
    })).toEqual({
      subrunTrace: trace,
      subrunTraceVersion: 3,
      lazySubrunTraceSource: lazySource,
      parentToolCallId: 'tool-1',
    });
  });

  it('未声明 capability 时不旁路暴露 Host 运行态', () => {
    expect(buildToolPresentationRuntimeBindings({
      capabilities: undefined,
      conversationId: 'conversation-1',
      parentToolCallId: 'tool-1',
      subrunTrace: {},
      subrunTraceVersion: 0,
      historicalSubrunTraceSource: lazySource,
    })).toEqual({});
  });

  it('历史资源读取身份与 subrun trace 分别声明', () => {
    expect(buildToolPresentationRuntimeBindings({
      capabilities: { conversationId: true },
      conversationId: 'conversation-1',
      parentToolCallId: 'tool-1',
      subrunTrace: {},
      subrunTraceVersion: 0,
      historicalSubrunTraceSource: lazySource,
    })).toEqual({ conversationId: 'conversation-1' });
  });

  it('只向声明 attachments capability 的工具卡传递 durable 图片引用', () => {
    const attachments = [{
      id: 'attachment-1',
      kind: 'image' as const,
      assetId: 'asset-1',
      mediaType: 'image/png' as const,
      byteLength: 12,
      width: 16,
      height: 9,
      sha256: 'a'.repeat(64),
    }];

    expect(buildToolPresentationRuntimeBindings({
      capabilities: { attachments: true },
      conversationId: 'conversation-1',
      parentToolCallId: 'tool-1',
      subrunTrace: undefined,
      subrunTraceVersion: 0,
      historicalSubrunTraceSource: undefined,
      attachments,
    })).toEqual({ attachments });

    expect(buildToolPresentationRuntimeBindings({
      capabilities: undefined,
      conversationId: 'conversation-1',
      parentToolCallId: 'tool-1',
      subrunTrace: undefined,
      subrunTraceVersion: 0,
      historicalSubrunTraceSource: undefined,
      attachments,
    })).toEqual({});
  });
});
