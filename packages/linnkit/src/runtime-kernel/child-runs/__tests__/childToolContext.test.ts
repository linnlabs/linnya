import { describe, expect, it } from 'vitest';

import { createChildRunToolContext, decideChildRunDepth } from '../childToolContext';
import { DEFAULT_MAX_CHILD_RUN_DEPTH } from '../types';
import { RunIdSchema } from '../../../contracts';

describe('childToolContext depth policy', () => {
  it('允许默认上限内的下一层 child-run', () => {
    expect(
      decideChildRunDepth({
        parentToolContext: { childRunDepth: DEFAULT_MAX_CHILD_RUN_DEPTH - 1 },
      })
    ).toEqual({
      allowed: true,
      nextDepth: DEFAULT_MAX_CHILD_RUN_DEPTH,
    });
  });

  it('父上下文已达默认上限时拒绝继续递归', () => {
    expect(
      decideChildRunDepth({
        parentToolContext: { childRunDepth: DEFAULT_MAX_CHILD_RUN_DEPTH },
      })
    ).toEqual({
      allowed: false,
      parentDepth: DEFAULT_MAX_CHILD_RUN_DEPTH,
      maxDepth: DEFAULT_MAX_CHILD_RUN_DEPTH,
      error: `Child run depth limit exceeded: parent depth ${DEFAULT_MAX_CHILD_RUN_DEPTH}, max depth ${DEFAULT_MAX_CHILD_RUN_DEPTH}.`,
    });
  });

  it('创建 child-run toolContext 时应抛出带 errorCode 的深度熔断错误', () => {
    expect(() =>
      createChildRunToolContext({
        parentToolContext: { childRunDepth: DEFAULT_MAX_CHILD_RUN_DEPTH },
        conversationId: 'conv_1',
        turnId: 'turn_1',
        runId: RunIdSchema.parse('run_child_1'),
        userQuery: 'depth limit',
        modelId: 'model-test',
        seedHistory: [],
      })
    ).toThrow(
      expect.objectContaining({
        name: 'ChildRunDepthExceededError',
        errorCode: 'engine.delegate_depth_exceeded',
        parentDepth: DEFAULT_MAX_CHILD_RUN_DEPTH,
        maxDepth: DEFAULT_MAX_CHILD_RUN_DEPTH,
      })
    );
  });

  it('缺失或非数字深度按顶层父上下文处理', () => {
    expect(
      decideChildRunDepth({
        parentToolContext: {},
      })
    ).toEqual({
      allowed: true,
      nextDepth: 1,
    });
  });

  it('递归 child 应继承同一个显式 child-run invoker capability', () => {
    const registeredChildRunInvoker = {
      invoke: async () => ({
        subrunId: 'nested-child',
        success: true,
        events: [],
        stepCount: 0,
      }),
    };
    const childContext = createChildRunToolContext({
      parentToolContext: { registeredChildRunInvoker },
      conversationId: 'conv-recursive-child',
      turnId: 'turn-recursive-child',
      runId: RunIdSchema.parse('run-recursive-child'),
      userQuery: 'nested child',
      modelId: 'model-test',
      seedHistory: [],
    });

    expect(childContext.registeredChildRunInvoker).toBe(registeredChildRunInvoker);
  });

  it('递归 child 应继承 root admission 冻结的环境注入', () => {
    const childRunContextInjections = [{
      kind: 'project-context',
      content: 'project name: test',
    }];
    const childContext = createChildRunToolContext({
      parentToolContext: { childRunContextInjections },
      conversationId: 'conv-context-child',
      turnId: 'turn-context-child',
      runId: RunIdSchema.parse('run-context-child'),
      userQuery: 'nested child',
      modelId: 'model-test',
      seedHistory: [],
    });

    expect(childContext.childRunContextInjections).toBe(childRunContextInjections);
  });
});
