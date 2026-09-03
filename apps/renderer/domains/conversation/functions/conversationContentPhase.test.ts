import { describe, expect, it } from 'vitest';
import {
  resolveConversationContentPhase,
  shouldMountConversationHost,
  type ResolveConversationContentPhaseInput,
} from './conversationContentPhase';

const baseInput: ResolveConversationContentPhaseInput = {
  activeConversationId: 'conversation-a',
  selectedConversationId: 'conversation-a',
  isHistoryReplayLoading: false,
  hasRenderableSourceMessages: false,
  hasRenderableItems: false,
};

function resolvePhase(input: Partial<ResolveConversationContentPhaseInput>) {
  return resolveConversationContentPhase({
    ...baseInput,
    ...input,
  });
}

describe('resolveConversationContentPhase', () => {
  it('没有当前会话且没有加载意图时才是草稿态', () => {
    expect(resolvePhase({
      activeConversationId: null,
      selectedConversationId: null,
    })).toBe('draft');
  });

  it('navigation loading intent 先于 active 壳时，不应短暂落入草稿态', () => {
    expect(resolvePhase({
      activeConversationId: null,
      selectedConversationId: 'conversation-b',
      isHistoryReplayLoading: true,
    })).toBe('history-loading');
  });

  it('历史 loading 壳没有可渲染内容时保持 loading 态', () => {
    expect(resolvePhase({
      isHistoryReplayLoading: true,
      hasRenderableSourceMessages: false,
      hasRenderableItems: false,
    })).toBe('history-loading');
  });

  it('tail snapshot 有源消息但派生项尚未产出时仍保持 loading 态', () => {
    expect(resolvePhase({
      isHistoryReplayLoading: true,
      hasRenderableSourceMessages: true,
      hasRenderableItems: false,
    })).toBe('history-loading');
  });

  it('窗口加载期间即使已有内容也保持 loading 态', () => {
    expect(resolvePhase({
      isHistoryReplayLoading: true,
      hasRenderableSourceMessages: true,
      hasRenderableItems: true,
    })).toBe('history-loading');
  });

  it('回放完成且有可展示内容时进入 ready', () => {
    expect(resolvePhase({
      isHistoryReplayLoading: false,
      hasRenderableSourceMessages: true,
      hasRenderableItems: true,
    })).toBe('ready');
  });

  it('回放完成但确实没有可渲染内容时才进入 ready-empty', () => {
    expect(resolvePhase({
      isHistoryReplayLoading: false,
      hasRenderableSourceMessages: false,
      hasRenderableItems: false,
    })).toBe('ready-empty');
  });
});

describe('shouldMountConversationHost', () => {
  it('只为历史加载态和已有内容态挂载真实会话树', () => {
    expect(shouldMountConversationHost('draft')).toBe(false);
    expect(shouldMountConversationHost('ready-empty')).toBe(false);
    expect(shouldMountConversationHost('history-loading')).toBe(true);
    expect(shouldMountConversationHost('ready')).toBe(true);
  });
});
