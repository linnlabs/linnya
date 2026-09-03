import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { ConversationTitleOrigin } from '../definitions/conversationTitle';
import { useConversationTitleCandidateStore } from '../store/conversationTitleCandidateStore';
import { createConversationTitleCoordinator } from './conversationTitleCoordinator';

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

describe('conversationTitleCoordinator', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function createHarness(options: {
    automaticTitleEnabled?: boolean;
    generateTitle?: (
      conversationId: string,
      userText: string,
      generationId: string,
      signal: AbortSignal,
    ) => Promise<string>;
    persistTitle?: (conversationId: string, title: string) => Promise<void>;
  } = {}) {
    const candidates = useConversationTitleCandidateStore();
    const commits: Array<{
      conversationId: string;
      title: string;
      origin: ConversationTitleOrigin;
    }> = [];
    const generateTitle = vi.fn(options.generateTitle ?? (async () => '东京三日游规划'));
    const persistTitle = vi.fn(options.persistTitle ?? (async () => undefined));
    const reportFallbackPersistenceFailure = vi.fn();
    const reportGenerationFailure = vi.fn();
    const coordinator = createConversationTitleCoordinator({
      candidates,
      isAutomaticTitleEnabled: () => options.automaticTitleEnabled ?? true,
      createGenerationId: () => 'generation-1',
      generateTitle,
      persistTitle,
      commitTitle: (conversationId, title, origin) => {
        commits.push({ conversationId, title, origin });
      },
      reportFallbackPersistenceFailure,
      reportGenerationFailure,
    });
    return {
      candidates,
      commits,
      coordinator,
      generateTitle,
      persistTitle,
      reportFallbackPersistenceFailure,
      reportGenerationFailure,
    };
  }

  it('只有本次运行期创建的新会话可以认领自动标题资格', () => {
    const harness = createHarness();

    harness.coordinator.handleUserMessage({
      conversationId: 'history-conversation',
      userText: '旧会话的第二轮追问',
    });

    expect(harness.generateTitle).not.toHaveBeenCalled();
    expect(harness.commits).toEqual([]);
  });

  it('durable ack 后立即启动标题模型，但 fallback 必须先持久化再提交读取面', async () => {
    const fallbackWrite = deferred<void>();
    const generation = deferred<string>();
    const harness = createHarness({
      persistTitle: async (_conversationId, title) => {
        if (title === '帮我规划东京三日游') await fallbackWrite.promise;
      },
      generateTitle: async () => generation.promise,
    });
    harness.coordinator.registerAutomaticCandidate('conversation-1');

    const fallbackSettled = harness.coordinator.handleUserMessage({
      conversationId: 'conversation-1',
      userText: '  帮我规划东京三日游  ',
    });

    expect(harness.commits).toEqual([]);
    expect(harness.generateTitle).toHaveBeenCalledWith(
      'conversation-1',
      '帮我规划东京三日游',
      'generation-1',
      expect.any(AbortSignal),
    );

    fallbackWrite.resolve();
    await fallbackSettled;
    expect(harness.commits).toEqual([{
      conversationId: 'conversation-1',
      title: '帮我规划东京三日游',
      origin: 'fallback',
    }]);

    generation.resolve('东京三日游规划');
    await vi.waitFor(() => expect(harness.persistTitle).toHaveBeenCalledWith(
      'conversation-1',
      '东京三日游规划',
    ));
    expect(harness.commits[harness.commits.length - 1]).toEqual({
      conversationId: 'conversation-1',
      title: '东京三日游规划',
      origin: 'automatic',
    });
    expect(harness.candidates.getCandidate('conversation-1')).toBeNull();
  });

  it('关闭模型生成时仍持久化确定性的首问 fallback，且不留下候选', async () => {
    const harness = createHarness({ automaticTitleEnabled: false });
    harness.coordinator.registerAutomaticCandidate('conversation-1');

    await harness.coordinator.handleUserMessage({
      conversationId: 'conversation-1',
      userText: '  第一问  ',
    });

    expect(harness.persistTitle).toHaveBeenCalledWith('conversation-1', '第一问');
    expect(harness.commits).toEqual([{
      conversationId: 'conversation-1',
      title: '第一问',
      origin: 'fallback',
    }]);
    expect(harness.generateTitle).not.toHaveBeenCalled();
    expect(harness.candidates.getCandidate('conversation-1')).toBeNull();
  });

  it('fallback 持久化失败时不提交前端读取面，并允许调用方继续历史同步', async () => {
    const failure = new Error('title write failed');
    const harness = createHarness({
      automaticTitleEnabled: false,
      persistTitle: async () => {
        throw failure;
      },
    });
    harness.coordinator.registerAutomaticCandidate('conversation-1');

    await expect(harness.coordinator.handleUserMessage({
      conversationId: 'conversation-1',
      userText: '第一问',
    })).resolves.toBeUndefined();

    expect(harness.commits).toEqual([]);
    expect(harness.reportFallbackPersistenceFailure).toHaveBeenCalledWith(
      'conversation-1',
      failure,
    );
  });

  it('第二次用户动作会取消已经运行的标题模型', async () => {
    const generation = deferred<string>();
    let observedSignal: AbortSignal | null = null;
    const harness = createHarness({
      generateTitle: async (_conversationId, _userText, _generationId, signal) => {
        observedSignal = signal;
        return generation.promise;
      },
    });
    harness.coordinator.registerAutomaticCandidate('conversation-1');
    harness.coordinator.handleUserMessage({
      conversationId: 'conversation-1',
      userText: '第一问',
    });
    await vi.waitFor(() => expect(harness.generateTitle).toHaveBeenCalledTimes(1));

    harness.coordinator.handleUserMessage({
      conversationId: 'conversation-1',
      userText: '第二问',
    });
    generation.resolve('迟到标题');

    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    expect(harness.persistTitle).toHaveBeenCalledWith('conversation-1', '第一问');
    expect(harness.persistTitle).not.toHaveBeenCalledWith('conversation-1', '迟到标题');
  });

  it('手动改名与已开始的自动写入串行，用户标题最终获胜', async () => {
    const automaticWrite = deferred<void>();
    const persistedTitles: string[] = [];
    const harness = createHarness({
      persistTitle: async (_conversationId, title) => {
        persistedTitles.push(title);
        if (title === '自动标题') await automaticWrite.promise;
      },
      generateTitle: async () => '自动标题',
    });
    harness.coordinator.registerAutomaticCandidate('conversation-1');
    await harness.coordinator.handleUserMessage({
      conversationId: 'conversation-1',
      userText: '第一问',
    });
    await vi.waitFor(() => expect(persistedTitles).toEqual(['第一问', '自动标题']));

    const rename = harness.coordinator.renameConversation('conversation-1', '用户标题');
    expect(persistedTitles).toEqual(['第一问', '自动标题']);
    automaticWrite.resolve();
    await rename;

    expect(persistedTitles).toEqual(['第一问', '自动标题', '用户标题']);
    expect(harness.commits[harness.commits.length - 1]).toEqual({
      conversationId: 'conversation-1',
      title: '用户标题',
      origin: 'explicit',
    });
  });

  it('第二次用户动作撞上标题持久化时会在队列末尾恢复 fallback', async () => {
    const automaticWrite = deferred<void>();
    const persistedTitles: string[] = [];
    const harness = createHarness({
      persistTitle: async (_conversationId, title) => {
        persistedTitles.push(title);
        if (title === '自动标题') await automaticWrite.promise;
      },
      generateTitle: async () => '自动标题',
    });
    harness.coordinator.registerAutomaticCandidate('conversation-1');
    await harness.coordinator.handleUserMessage({
      conversationId: 'conversation-1',
      userText: '第一问',
    });
    await vi.waitFor(() => expect(persistedTitles).toEqual(['第一问', '自动标题']));

    harness.coordinator.handleUserMessage({
      conversationId: 'conversation-1',
      userText: '第二问',
    });
    automaticWrite.resolve();

    await vi.waitFor(() => expect(persistedTitles).toEqual(['第一问', '自动标题', '第一问']));
    expect(harness.commits[harness.commits.length - 1]).toEqual({
      conversationId: 'conversation-1',
      title: '第一问',
      origin: 'fallback',
    });
  });
});
