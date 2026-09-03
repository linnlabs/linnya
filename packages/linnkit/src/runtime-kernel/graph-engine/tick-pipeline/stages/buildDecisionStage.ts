import {
  generateAnswerSegmentId,
  generateRuntimeEventId,
  ToolCallIdSchema,
} from '../../../../contracts';
import type { FinalAnswerEvent, ToolCallDecisionEvent } from '../../../events/agentEvents';
import { defineTickStage } from '../types';
import type { TickStage } from '../types';
import {
  extractResponseText,
  normalizeToolCalls,
  parsePrimaryToolArgs,
  resolveProviderContinuations,
  resolveAssistantReplayParts,
  resolveToolCalls,
} from '../helpers';

export function createBuildDecisionStage(): TickStage {
  return defineTickStage({
    id: 'build_decision',
    reads: ['llmResp', 'outputProcessor', 'forceFinalAnswer', 'eventHandler'],
    writes: ['decision'],
    async run(ctx) {
      const rawRespText = extractResponseText(ctx.llmResp);
      const respText = ctx.outputProcessor?.processResponse
        ? ctx.outputProcessor.processResponse(rawRespText)
        : rawRespText;
      const toolCallsRaw = resolveToolCalls(ctx.llmResp);
      const providerContinuations = resolveProviderContinuations(ctx.llmResp);
      const assistantReplayParts = resolveAssistantReplayParts(ctx.llmResp);
      const toolCalls = ctx.forceFinalAnswer ? undefined : toolCallsRaw;

      if (toolCalls?.length) {
        const normalizedToolCalls = normalizeToolCalls(toolCalls).map((toolCall, index) => ({
          ...toolCall,
          id: ToolCallIdSchema.parse(toolCall.id, {
            path: [`tool_calls[${index}].id`],
          }),
        }));
        const firstToolCall = normalizedToolCalls[0];
        if (!firstToolCall) {
          throw new Error('Tool decision must contain at least one normalized tool call.');
        }
        normalizedToolCalls.forEach((toolCall, index) => {
          requireNonEmptyToolIdentity(toolCall.function.name, `tool_calls[${index}].function.name`);
        });
        const primaryArgs = parsePrimaryToolArgs(firstToolCall);
        const primaryToolName = firstToolCall.function.name.trim();
        const primaryToolCallId = firstToolCall.id;

        const actionEvent: ToolCallDecisionEvent = {
          type: 'tool_call_decision',
          timestamp: Date.now(),
          tool_name: primaryToolName,
          tool_args: primaryArgs,
          tool_calls: normalizedToolCalls,
          tool_call_id: primaryToolCallId,
          phase: 'start',
          status: 'loading',
          payload: {
            args: primaryArgs,
            tool_calls: normalizedToolCalls,
            ...(providerContinuations?.length
              ? { provider_continuations: providerContinuations }
              : {}),
            ...(assistantReplayParts?.length
              ? { assistant_replay_parts: assistantReplayParts }
              : {}),
          },
          meta: {
            primary_tool_call_id: primaryToolCallId,
            tool_call_ids: normalizedToolCalls.map(toolCall => toolCall.id),
            tool_batch_size: normalizedToolCalls.length,
          },
          id: generateRuntimeEventId(),
        };

        ctx.eventHandler?.(actionEvent);
        return {
          decision: {
            kind: 'tool_calls',
            toolCalls: normalizedToolCalls,
          },
        };
      }

      if (respText.trim().length > 0) {
        const answerId = generateAnswerSegmentId();
        const finalAnswerContinuation =
          providerContinuations?.length
            ? { provider_continuations: providerContinuations }
            : {};
        const finalEvent: FinalAnswerEvent = {
          type: 'final_answer',
          timestamp: Date.now(),
          answer: respText,
          answer_id: answerId,
          completion_reason: 'terminal',
          id: answerId,
          ...finalAnswerContinuation,
          ...(assistantReplayParts?.length
            ? { assistant_replay_parts: assistantReplayParts }
            : {}),
        };
        ctx.eventHandler?.(finalEvent);
        return {
          decision: { kind: 'final_answer', answer: respText },
        };
      }

      return {
        decision: { kind: 'yield' },
      };
    },
  });
}

function requireNonEmptyToolIdentity(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
}
