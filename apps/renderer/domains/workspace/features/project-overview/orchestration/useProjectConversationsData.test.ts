import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConversationRow, ProjectConversations } from '@app/schemas';

const gateway = vi.hoisted(() => ({ read: vi.fn(), measure: vi.fn() }));
vi.mock('../infrastructure/projectConversationsGateway', () => ({
  readProjectConversations: gateway.read,
  measureProjectConversationStorage: gateway.measure,
}));
import { useProjectConversationsData } from './useProjectConversationsData';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function list(id: string): ProjectConversations {
  return { conversations: [{ conversation_id: id, storage: null } as unknown as ProjectConversationRow] } as unknown as ProjectConversations;
}
const settle = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); await nextTick(); };
let scope: EffectScope;
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); scope = effectScope(); });
afterEach(() => { scope.stop(); vi.useRealTimers(); });

describe('项目对话列表读取', () => {
  it('换项目后旧请求收尾不能放开串行锁，后发先到的旧结果不会盖掉新结果', async () => {
    const first = deferred<ProjectConversations>();
    const second = deferred<ProjectConversations>();
    const third = deferred<ProjectConversations>();
    gateway.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const id = ref('p'); const key = ref('k0');
    const data = scope.run(() => useProjectConversationsData(id, key, ref(false)))!;
    id.value = 'q'; await settle();
    expect(gateway.read).toHaveBeenCalledTimes(2);
    first.resolve(list('from-p')); await settle();
    // 新项目的读取还没回来，历史变化不能再并发发起第三次读取，而是排到这一次之后。
    key.value = 'k1'; await nextTick(); await vi.advanceTimersByTimeAsync(600); await settle();
    expect(gateway.read).toHaveBeenCalledTimes(2);
    second.resolve(list('from-q-first')); await settle();
    expect(data.rows.value.map(row => row.conversation_id)).toEqual(['from-q-first']);
    expect(gateway.read).toHaveBeenCalledTimes(3);
    third.resolve(list('from-q-second')); await settle();
    expect(data.rows.value.map(row => row.conversation_id)).toEqual(['from-q-second']);
    expect(data.status.value).toBe('ready');
  });
});
