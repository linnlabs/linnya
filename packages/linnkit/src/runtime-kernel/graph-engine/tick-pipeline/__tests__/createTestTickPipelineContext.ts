import type { AgentInvocationRequest } from '../../../../ports/agent-invocation';
import { noopAudit } from '../../../audit/noopAudit';
import { noopTelemetry } from '../../../telemetry/noopTelemetry';
import { createDefaultTokenizerPort } from '../../../../shared/defaultTokenizerPort';
import type { TickPipelineContext } from '../types';

interface CreateTestTickPipelineContextOverrides {
  request?: Partial<AgentInvocationRequest>;
  context?: Partial<TickPipelineContext>;
}

/**
 * 测试夹具：构造一个最小可用的 TickPipelineContext。
 *
 * 仅供 packages/linnkit 内部 *.test.ts 使用。
 *
 * 默认值挑选原则：
 * - request：带最常用字段（query/promptKey/model_id/maxSteps），调用方可通过 overrides.request 局部覆盖
 * - telemetry：默认 noopTelemetry，调用方需要断言 emit 时可在 overrides.context.telemetry 注入 spy
 * - 其他字段：所有 TickPipelineContext 必填字段都给出无副作用的零值
 */
export function createTestTickPipelineContext(
  overrides: CreateTestTickPipelineContextOverrides = {}
): TickPipelineContext {
  const request: AgentInvocationRequest = {
    query: '继续执行',
    promptKey: 'default',
    model_id: 'mock-model',
    maxSteps: 8,
    enableTools: false,
    availableTools: [],
    ...overrides.request,
  };

  return {
    input: {
      request,
      history: [],
      stream: false,
    },
    request,
    history: [],
    forceFinalAnswer: false,
    modelId: '',
    toolSchemas: [],
    toolCallStreamingPolicies: {},
    llmOptions: {},
    toolDefinitionTokens: 0,
    llmMessages: [],
    conversationId: 'conv_test',
    turnId: 'turn_test',
    telemetry: noopTelemetry,
    audit: noopAudit,
    tokenizer: createDefaultTokenizerPort(),
    ...overrides.context,
  };
}
