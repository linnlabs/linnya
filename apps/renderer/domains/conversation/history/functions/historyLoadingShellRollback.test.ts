import { describe, expect, it } from 'vitest';
import {
  resolveHistoryLoadingShellRollbackAction,
  type ResolveHistoryLoadingShellRollbackActionInput,
} from './historyLoadingShellRollback';

const baseInput: ResolveHistoryLoadingShellRollbackActionInput = {
  shellRequestToken: 1,
  ownedShellRequestToken: 1,
  hasExistingConversation: true,
  hasFallbackConversation: true,
};

function resolveAction(input: Partial<ResolveHistoryLoadingShellRollbackActionInput>) {
  return resolveHistoryLoadingShellRollbackAction({
    ...baseInput,
    ...input,
  });
}

describe('resolveHistoryLoadingShellRollbackAction', () => {
  it('新 token 仍在加载同一会话时，旧请求不能删除新壳', () => {
    expect(resolveAction({
      ownedShellRequestToken: 2,
    })).toBe('skip-newer-same-conversation');
  });

  it('旧 loading 壳有 fallback 时恢复原会话', () => {
    expect(resolveAction({})).toBe('restore-fallback');
  });

  it('旧 loading 壳没有 fallback 时移除壳', () => {
    expect(resolveAction({
      hasFallbackConversation: false,
    })).toBe('remove-shell');
  });

  it('会话已经不由 loading 壳拥有时不回滚', () => {
    expect(resolveAction({
      ownedShellRequestToken: null,
    })).toBe('ignore-unowned-conversation');
  });
});
