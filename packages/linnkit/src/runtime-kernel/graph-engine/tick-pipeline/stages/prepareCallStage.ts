import type { LlmCallOptions } from '../../../llm/caller';
import type { ModelCatalogLike } from '../../../llm/modelCatalog';
import type { ModelResolverLike } from '../../../llm/modelResolver';
import { resolveEffectiveEffort } from '../../../llm/functions/reasoningEffort';
import type { ToolCatalogPort } from '../../../tools/ports';
import { defineTickStage } from '../types';
import type { TickStage } from '../types';
import { readNonEmptyString } from '../helpers';
import { emitAuditEnvelope } from '../../../audit/emitAudit';
import { prepareModelCompatibleTools } from '../../functions/prepareModelCompatibleTools';
import { runIdFromTurnId } from '../../../../contracts';
import type { ToolCallStreamingPolicy } from '../../../tools/toolContracts';
import { estimateToolDefinitionTokens } from '../../functions/promptUsageComponents';

export interface PrepareCallStageDependencies {
  modelResolver: Pick<ModelResolverLike, 'resolveModelId'>;
  modelCatalog: Pick<ModelCatalogLike, 'getModelById'>;
  toolCatalog: Pick<ToolCatalogPort, 'getToolSchemas' | 'getToolDefinition'>;
  cloudQuotaFallbackModelId?: string;
}

export function createPrepareCallStage(dependencies: PrepareCallStageDependencies): TickStage {
  return defineTickStage({
    id: 'prepare_call',
    reads: [
      'request',
      'executorLocal',
      'forceFinalAnswer',
      'conversationId',
      'turnId',
      'input',
      'audit',
      'tokenizer',
    ],
    writes: [
      'modelId',
      'toolSchemas',
      'toolModelInputRequirement',
      'toolCallStreamingPolicies',
      'llmOptions',
      'toolDefinitionTokens',
    ],
    async run(ctx) {
      const lockedRunModelId = readNonEmptyString(ctx.executorLocal?.runLockedModelId);
      const requestedModelId = lockedRunModelId ?? ctx.request.model_id;
      const modelId = dependencies.modelResolver.resolveModelId(requestedModelId);
      await emitAuditEnvelope(ctx.audit, {
        action: 'model.select',
        actor: { kind: 'system' },
        decision: {
          outcome: 'recorded',
          reason: lockedRunModelId
            ? 'run model lock'
            : requestedModelId
              ? 'request model id'
              : 'default model resolver',
          metadata: {
            requestedModelId,
            lockedRunModelId,
            selectedModelId: modelId,
          },
        },
        evidence: [
          {
            kind: 'model_resolver',
            summary: `selected ${modelId}`,
          },
        ],
        scope: {
          conversationId: ctx.conversationId || undefined,
          turnId: ctx.turnId,
          runId: ctx.input.toolContext?.runId ?? runIdFromTurnId(ctx.turnId),
          parentRunId: ctx.input.toolContext?.parentRunId,
          modelId,
        },
      });
      const candidateToolSchemas = dependencies.toolCatalog.getToolSchemas({
        toolNames: ctx.request.availableTools,
        invocation: ctx.request,
      });
      const modelConfig = dependencies.modelCatalog.getModelById(modelId);
      const toolPreparation = prepareModelCompatibleTools({
        schemas: candidateToolSchemas,
        model: modelConfig,
        getToolDefinition: toolName => dependencies.toolCatalog.getToolDefinition(toolName),
      });
      const toolSchemas = [...toolPreparation.schemas];
      const toolCallStreamingPolicies = deriveToolCallStreamingPolicies(
        toolSchemas,
        dependencies.toolCatalog
      );

      const llmOptions: LlmCallOptions = {};
      if (!ctx.forceFinalAnswer && ctx.request.enableTools !== false && toolSchemas.length > 0) {
        llmOptions.tools = toolSchemas.map(schema => ({
          name: schema.function.name,
          description: schema.function.description,
          parameters: schema.function.parameters,
        }));
        if (ctx.executorLocal?.phase === 'force_tools') {
          const firstToolName = toolSchemas[0]?.function?.name;
          llmOptions.tool_choice =
            typeof firstToolName === 'string' && firstToolName.trim().length > 0
              ? { type: 'tool', name: firstToolName.trim() }
              : 'auto';
        } else {
          llmOptions.tool_choice = 'auto';
        }
      } else {
        llmOptions.tool_choice = 'none';
      }

      if (ctx.executorLocal?.lockRequestedModelId === true) {
        llmOptions.allow_model_fallback = false;
      }

      // 云端限额降级仅在 run 内续跑时生效，用户发起的首次 LLM 调用不降级（直接报错）。
      // 中文备注：
      // - 这里必须读取 GraphExecutor 注入的显式调用语义；
      // - stepCount 会受 child-run 直接从 llm 启动、checkpoint reset、收尾强制跳转影响，不能表达“首次/续跑”。
      const isRunContinuation = ctx.executorLocal?.llmInvocationKind === 'continuation';
      if (
        dependencies.cloudQuotaFallbackModelId &&
        modelConfig?.billing_mode === 'cloud' &&
        modelId !== dependencies.cloudQuotaFallbackModelId &&
        isRunContinuation &&
        ctx.executorLocal?.lockRequestedModelId !== true
      ) {
        llmOptions.cloud_quota_fallback_model_id = dependencies.cloudQuotaFallbackModelId;
      }

      const effectiveEffort = resolveEffectiveEffort(
        ctx.request.reasoning_effort,
        modelConfig?.reasoning
      );
      if (effectiveEffort !== null) {
        llmOptions.reasoning_effort = effectiveEffort;
      }

      const toolDefinitionTokens = estimateToolDefinitionTokens({
        tools: llmOptions.tools,
        toolChoice: llmOptions.tool_choice,
        modelId,
        tokenizer: ctx.tokenizer,
      });

      return {
        modelId,
        toolSchemas,
        toolModelInputRequirement: toolPreparation.requirement,
        toolCallStreamingPolicies,
        llmOptions,
        toolDefinitionTokens,
      };
    },
  });
}

function deriveToolCallStreamingPolicies(
  toolSchemas: readonly { readonly function?: { readonly name?: unknown } }[],
  toolCatalog: Pick<ToolCatalogPort, 'getToolDefinition'>
): Readonly<Record<string, ToolCallStreamingPolicy>> {
  const policies: Record<string, ToolCallStreamingPolicy> = {};
  for (const schema of toolSchemas) {
    const toolName = schema.function?.name;
    if (typeof toolName !== 'string' || toolName.trim().length === 0) continue;
    const policy = toolCatalog.getToolDefinition(toolName)?.streaming;
    if (policy) policies[toolName] = policy;
  }
  return policies;
}
