import { describe, expect, it } from 'vitest';

import {
  createDefaultGraphExecutor,
  createGraphLoopHarness,
  createScriptedInferenceHarness,
  createToolContextFixture,
} from '../index';
import { createFinalAnswerEvent, type RoutedRuntimeEvent, RunIdSchema } from '../../contracts';
import { execution } from '../../runtime-kernel';
import { createStandaloneFinalAnswerChunk } from '../../runtime-kernel/events';

describe('src/agent/testkit graph loop harness contract', () => {
  it('exposes createGraphLoopHarness as part of the public testkit surface', async () => {
    const moduleUnderTest = await import('../index');

    expect(moduleUnderTest.createGraphLoopHarness).toBeTypeOf('function');
    expect(moduleUnderTest.createDefaultGraphExecutor).toBeTypeOf('function');
  });

  it('creates a default graph executor through the public testkit seam', () => {
    const llmNode = {
      id: 'llm',
      async run() {
        return { kind: 'yield' as const, events: [] };
      },
    };
    const toolRuntime: Parameters<typeof createGraphLoopHarness>[0]['toolRuntime'] = {
      getToolSchemas() {
        return [];
      },
      getToolDefinition() {
        return undefined;
      },
      async executeTool() {
        throw new Error('default graph executor seam test did not expect tool execution');
      },
    };
    const observationPreview: Parameters<typeof createGraphLoopHarness>[0]['observationPreview'] = {
      async truncateObservation(params) {
        return {
          truncated: false,
          preview: params.text,
        };
      },
    };

    const executor = createDefaultGraphExecutor({
      llmNode,
      toolRuntime,
      observationPreview,
      maxSteps: 4,
    });

    expect(executor).toBeDefined();
  });

  it('runs the agent-owned graph loop internals behind the public testkit seam', async () => {
    type GraphLoopOptions = Parameters<typeof createGraphLoopHarness>[0];

    const conversationId = 'conv_public_graph_loop_contract';
    const turnId = 'turn_public_graph_loop_contract';
    const aiHarness = createScriptedInferenceHarness([]);
    const toolContext = createToolContextFixture({
      conversationId,
      turnId,
      historyEvents: [],
    });
    const toolRuntime: GraphLoopOptions['toolRuntime'] = {
      getToolSchemas() {
        return [];
      },
      getToolDefinition() {
        return undefined;
      },
      async executeTool() {
        throw new Error('graph loop contract test did not expect tool execution');
      },
    };
    const observationPreview: GraphLoopOptions['observationPreview'] = {
      async truncateObservation(params) {
        return {
          truncated: false,
          preview: params.text,
        };
      },
    };
    const publishedEvents: RoutedRuntimeEvent[] = [];
    const sequencer = new execution.EventSequencer(conversationId);
    const eventBus = new execution.EventBus(sequencer.getExecutionId());
    const publisher = new execution.RuntimeEventPublisher(eventBus, sequencer, {
      run_id: RunIdSchema.parse(turnId),
      lane: 'foreground',
      visibility: 'conversation',
    });
    eventBus.on('event', envelope => publishedEvents.push(envelope.payload));

    const harness = createGraphLoopHarness({
      conversationId,
      turnId,
      query: 'hello graph loop',
      request: {
        query: 'hello graph loop',
        promptKey: 'contract-test',
        enableTools: false,
        availableTools: [],
      },
      toolContext,
      llmCaller: aiHarness.getLlmCaller(),
      toolRuntime,
      observationPreview,
      createLlmNode: () => ({
        id: 'llm',
        async run(state) {
          const finalAnswer = createFinalAnswerEvent(
            'answer_public_graph_loop',
            conversationId,
            turnId,
            'public graph loop seam answered',
            { completion_reason: 'terminal' }
          );
          const runtimeEventSink = state.local?.runtimeEventSink;
          if (!runtimeEventSink) {
            throw new Error('graph loop contract requires runtime event admission');
          }
          return {
            kind: 'yield',
            events: [
              runtimeEventSink(
                createStandaloneFinalAnswerChunk(finalAnswer),
                'graphLoopHarness.contract.final_answer_chunk'
              ),
              runtimeEventSink(finalAnswer, 'graphLoopHarness.contract.final_answer'),
            ],
          };
        },
      }),
      maxSteps: 4,
      runtimeEventSink: (event, source) => publisher.publish(event, source),
    });

    const result = await harness.run();
    eventBus.close();

    expect(result).toMatchObject({ checkpointNodeId: 'llm', stepCount: 2 });
    expect(result.events).toHaveLength(2);
    expect(publishedEvents).toEqual(result.events);
    expect(result.events[0]).toMatchObject({
      type: 'final_answer_chunk',
      conversation_id: conversationId,
      turn_id: turnId,
      content: 'public graph loop seam answered',
      seq: 0,
    });
    expect(result.events[1]).toMatchObject({
      type: 'final_answer',
      conversation_id: conversationId,
      turn_id: turnId,
      content: 'public graph loop seam answered',
    });
    aiHarness.assertAllTurnsConsumed();
  });
});
