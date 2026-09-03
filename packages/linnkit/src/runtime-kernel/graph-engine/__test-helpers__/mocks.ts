/**
 * @file src/core/graph-engine/__test-helpers__/mocks.ts
 * @description Mock 工厂函数 - 为图执行引擎测试提供 Mock 对象
 */

import { vi } from 'vitest';
import type { Checkpointer } from '../checkpointer/base';
import type { EngineState, GraphNode, NodeResult } from '../types';
import type { RoutedRuntimeEvent, RuntimeEvent } from '../../../contracts';
import { RunIdSchema } from '../../../contracts';
import { RuntimeEvent as RuntimeEventSchema } from '../../../contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readContent(value: unknown): string {
  return isRecord(value) && typeof value.content === 'string' ? value.content : '';
}

/**
 * 创建 Mock Checkpointer
 */
export function createMockCheckpointer() {
  const states = new Map<string, EngineState>();

  return {
    save: vi.fn<Checkpointer['save']>(async (checkpointKey, state) => {
      states.set(checkpointKey, state);
    }),
    load: vi.fn<Checkpointer['load']>(async checkpointKey => {
      return states.get(checkpointKey) || null;
    }),
    clear: vi.fn<Checkpointer['clear']>(async checkpointKey => {
      states.delete(checkpointKey);
    }),
    _states: states, // 测试辅助：访问内部状态
  } satisfies Checkpointer & { _states: Map<string, EngineState> };
}

/**
 * 创建 Mock GraphNode
 */
export function createMockNode(
  id: string,
  result: NodeResult | ((state: EngineState) => Promise<NodeResult>)
): GraphNode {
  const runFn = typeof result === 'function' ? result : async () => result;

  return {
    id,
    run: vi.fn(runFn),
  };
}

/**
 * 创建简单的 route 结果节点
 */
export function createRouteNode(
  id: string,
  nextNodeId: string,
  events: RoutedRuntimeEvent[] = []
): GraphNode {
  return createMockNode(id, {
    kind: 'route',
    nextNodeId,
    events,
  });
}

/**
 * 创建 yield 节点
 */
export function createYieldNode(id: string, events: RoutedRuntimeEvent[] = []): GraphNode {
  return createMockNode(id, {
    kind: 'yield',
    events,
  });
}

/**
 * 创建 pause 节点
 */
export function createPauseNode(id: string, events: RoutedRuntimeEvent[] = []): GraphNode {
  return createMockNode(id, {
    kind: 'pause',
    events,
  });
}

/**
 * 创建测试用的 EngineState
 */
export function createMockEngineState(
  nodeId: string = 'user',
  local: Record<string, unknown> = {}
): EngineState {
  return {
    nodeId,
    local,
  };
}

/**
 * 创建测试用的 RuntimeEvent
 */
export function createMockEvent(
  type: 'thought',
  overrides?: Partial<Extract<RuntimeEvent, { type: 'thought' }>>
): Extract<RoutedRuntimeEvent, { type: 'thought' }>;
export function createMockEvent(
  type: 'user_input',
  overrides?: Partial<Extract<RuntimeEvent, { type: 'user_input' }>>
): Extract<RoutedRuntimeEvent, { type: 'user_input' }>;
export function createMockEvent(
  type: 'final_answer',
  overrides?: Partial<Extract<RuntimeEvent, { type: 'final_answer' }>>
): Extract<RoutedRuntimeEvent, { type: 'final_answer' }>;
export function createMockEvent(
  type: 'thought' | 'user_input' | 'final_answer',
  overrides: Partial<RuntimeEvent> = {}
): RoutedRuntimeEvent {
  const content = readContent(overrides);
  const base = {
    id: `test_${Date.now()}`,
    conversation_id: 'conv_test',
    turn_id: 'turn_test',
    timestamp: Date.now(),
    version: 1 as const,
    run_id: RunIdSchema.parse('run_test'),
    lane: 'foreground' as const,
    visibility: 'conversation' as const,
  };

  if (type === 'user_input') {
    return {
      ...base,
      ...(overrides as Partial<Extract<RuntimeEvent, { type: 'user_input' }>>),
      type: 'user_input',
      content,
      source: 'user',
    };
  }

  if (type === 'final_answer') {
    const finalAnswerOverrides = overrides as Partial<
      Extract<RuntimeEvent, { type: 'final_answer' }>
    >;
    const answerId = finalAnswerOverrides.answer_id ?? 'answer_test';
    const completionReason = finalAnswerOverrides.completion_reason ?? 'terminal';
    return {
      ...base,
      ...finalAnswerOverrides,
      type: 'final_answer',
      id: answerId,
      answer_id: answerId,
      content,
      completion_reason: completionReason,
      is_complete: completionReason !== 'interrupted',
    };
  }

  return {
    ...base,
    ...(overrides as Partial<Extract<RuntimeEvent, { type: 'thought' }>>),
    type: 'thought',
    content,
    is_complete: false,
  };
}

/**
 * 创建测试用的历史事件数组
 */
export function createMockHistory(length: number = 5): RuntimeEvent[] {
  const history: RuntimeEvent[] = [];

  for (let i = 0; i < length; i++) {
    const isUser = i % 2 === 0;
    history.push(
      RuntimeEventSchema.parse({
        type: isUser ? 'user_input' : 'final_answer',
        id: `msg_${i}`,
        content: `Message ${i}`,
        conversation_id: 'conv_test',
        turn_id: `turn_${Math.floor(i / 2)}`,
        timestamp: Date.now() + i * 1000,
        version: 1,
        source: isUser ? 'user' : undefined,
      })
    );
  }

  return history;
}

/**
 * 创建动态节点（可以在运行时改变行为）
 */
export function createDynamicNode(id: string) {
  let nextResult: NodeResult = { kind: 'yield', events: [] };

  const node: GraphNode = {
    id,
    run: vi.fn(async () => nextResult),
  };

  return {
    node,
    setResult: (result: NodeResult) => {
      nextResult = result;
    },
  };
}
