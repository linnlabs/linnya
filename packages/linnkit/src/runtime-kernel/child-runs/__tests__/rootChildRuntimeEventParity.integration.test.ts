import { describe, expect, it } from 'vitest';

import {
  type RuntimeEvent,
  type RuntimeEventRoutingIdentity,
  RunIdSchema,
} from '../../../contracts';
import { EventBus, EventSequencer, RuntimeEventPublisher } from '../../execution';
import { MemoryCheckpointer } from '../../graph-engine/checkpointer/memoryCheckpointer';
import { GraphExecutor } from '../../graph-engine/engine';
import { LlmNode, type LlmNodeReasoner } from '../../graph-engine/nodes/llmNode';
import type { RuntimeEventSink } from '../../graph-engine/types';
import type { ObservationPreviewPort, ToolRuntimePort } from '../../tools/ports';
import { ChildRunInvoker } from '../childRunInvoker';

const conversationId = 'conv_parity';
const answerId = 'answer_scripted';

const observationPreview: ObservationPreviewPort = {
  async truncateObservation({ text }) {
    return { truncated: false, preview: text };
  },
};

const unusedToolRuntime: Pick<ToolRuntimePort, 'getToolDefinition' | 'executeTool'> = {
  getToolDefinition: () => undefined,
  async executeTool() {
    throw new Error('root/child 直答 parity 场景不应执行工具');
  },
};

function createScriptedReasoner(): LlmNodeReasoner {
  return {
    async tick(_input, eventHandler) {
      eventHandler?.({
        type: 'stream_chunk',
        id: 'chunk_0',
        timestamp: 1,
        answer_id: answerId,
        seq: 0,
        content: '第一段',
      });
      eventHandler?.({
        type: 'stream_chunk',
        id: 'chunk_1',
        timestamp: 2,
        answer_id: answerId,
        seq: 1,
        content: '第二段',
      });
      eventHandler?.({
        type: 'final_answer',
        id: 'provider_final',
        timestamp: 3,
        answer_id: answerId,
        answer: '第一段第二段',
        completion_reason: 'terminal',
      });
      return {
        decision: { kind: 'final_answer', answer: '第一段第二段' },
        newEvents: [],
      };
    },
  };
}

function projectAnswerFacts(events: RuntimeEvent[]): Array<Record<string, unknown>> {
  return events.map(event => {
    switch (event.type) {
      case 'final_answer_chunk':
        return {
          type: event.type,
          id: event.id,
          answer_id: event.answer_id,
          seq: event.seq,
          content: event.content,
          is_last: event.is_last,
        };
      case 'final_answer':
        return {
          type: event.type,
          id: event.id,
          answer_id: event.answer_id,
          content: event.content,
          is_complete: event.is_complete,
        };
      default:
        throw new Error(`parity 脚本产生了非答案事实: ${event.type}`);
    }
  });
}

function expectIdentity(events: RuntimeEvent[], identity: RuntimeEventRoutingIdentity): void {
  expect(events).not.toHaveLength(0);
  for (const event of events) {
    expect(event).toMatchObject(identity);
  }
}

describe('root/child RuntimeEvent parity', () => {
  it('相同 scripted flow 产生相同答案事实和终态，只允许路由身份不同', async () => {
    const rootIdentity: RuntimeEventRoutingIdentity = {
      run_id: RunIdSchema.parse('run_root'),
      lane: 'foreground',
      visibility: 'conversation',
    };
    const rootExecutor = new GraphExecutor(new MemoryCheckpointer(), { maxSteps: 4 });
    rootExecutor.registerNode(new LlmNode({ reasoner: createScriptedReasoner() }));
    const rootSequencer = new EventSequencer(conversationId);
    const rootEventBus = new EventBus(rootSequencer.getExecutionId());
    const rootPublisher = new RuntimeEventPublisher(rootEventBus, rootSequencer, rootIdentity);
    const rootRuntimeEventSink: RuntimeEventSink = (event, source) =>
      rootPublisher.publish(event, source);

    const rootResult = await rootExecutor.startSession(
      'root_checkpoint',
      {
        conversationId,
        turnId: 'turn_root',
        request: {
          query: '生成答案',
          promptKey: 'parity',
          enableTools: false,
          availableTools: [],
        },
        history: [],
        runtimeEventSink: rootRuntimeEventSink,
      },
      'llm'
    );

    const childInvoker = new ChildRunInvoker({
      modelResolver: { resolveModelId: () => 'scripted-model' },
      createLlmNode: () => new LlmNode({ reasoner: createScriptedReasoner() }),
      toolRuntime: unusedToolRuntime,
      observationPreview,
      eventToMessageConverter: () => [],
    });
    const childSequencer = new EventSequencer(conversationId);
    const childEventBus = new EventBus(childSequencer.getExecutionId());
    const childPublisher = new RuntimeEventPublisher(childEventBus, childSequencer, {
      run_id: RunIdSchema.parse('run_child'),
      parent_run_id: RunIdSchema.parse('run_root'),
      lane: 'child',
      visibility: 'parent-trace',
    });
    const childResult = await childInvoker.invoke({
      agentConfig: {
        id: 'parity-child',
        promptKey: 'parity',
        availableTools: [],
      },
      userMessage: '生成答案',
      parentToolContext: {
        conversationId,
        runId: RunIdSchema.parse('run_root'),
      },
      conversationId,
      runId: RunIdSchema.parse('run_child'),
      parentRunId: RunIdSchema.parse('run_root'),
      runtimeEventSink: (event, source) => childPublisher.publish(event, source),
      maxSteps: 4,
    });

    expect(rootResult.checkpoint.nodeId).toBe('llm');
    expect(childResult.success).toBe(true);
    expect(childResult.finalAnswer).toBe('第一段第二段');
    expect(projectAnswerFacts(childResult.events)).toEqual(projectAnswerFacts(rootResult.events));
    expectIdentity(rootResult.events, rootIdentity);
    expectIdentity(childResult.events, {
      run_id: RunIdSchema.parse('run_child'),
      parent_run_id: RunIdSchema.parse('run_root'),
      lane: 'child',
      visibility: 'parent-trace',
    });
  });
});
