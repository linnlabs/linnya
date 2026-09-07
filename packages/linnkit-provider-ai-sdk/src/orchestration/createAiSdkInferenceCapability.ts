import { stepCountIs, streamText, type ProviderMetadata } from 'ai';
import { toSerializableJsonRecord } from '@linnlabs/linnkit/contracts';
import type {
  CanonicalCompletedToolCall,
  CanonicalInferenceEvent,
} from '@linnlabs/linnkit/ports';
import {
  AiSdkHostStreamInvariantError,
  projectAiSdkFailureObservation,
  projectAiSdkFinishReason,
  type AiSdkFailurePhase,
  type AiSdkProviderFailureClassifier,
} from '../features/failure-projection';
import { resolveAiSdkStreamReliabilityPolicy } from '../features/stream-reliability';
import { projectAiSdkContinuation } from '../functions/projectAiSdkContinuation';
import {
  projectAiSdkGenerationSettings,
  projectAiSdkRequestProviderOptions,
  projectCanonicalToolConfiguration,
} from '../functions/projectCanonicalRequestToAiSdk';
import { projectCanonicalMessages } from '../functions/projectCanonicalMessages';
import { projectAiSdkUsage } from '../functions/projectAiSdkUsage';
import {
  projectAiSdkRequestDiagnostic,
  type AiSdkRequestDiagnosticSummary,
} from '../functions/projectAiSdkRequestDiagnostic';
import { assertAiSdkInferenceRouteMatchesCapability } from '../functions/assertAiSdkInferenceRouteMatchesCapability';
import type {
  AiSdkInferenceCapability,
  AiSdkInferenceSurface,
  AiSdkLanguageModelRegistry,
} from '../definitions/aiSdkInferenceSurface';
import type { AiSdkInferenceCapabilityId } from '../definitions/aiSdkCapabilityIds';
import type { AiSdkLanguageDiagnosticSink } from '../definitions/aiSdkLanguageDiagnostic';

interface ActiveReasoningPart {
  readonly index: number;
  text: string;
  metadata?: ProviderMetadata;
}

interface ActiveTextPart {
  readonly index: number;
  text: string;
  metadata?: ProviderMetadata;
}

function mergeMetadata(
  current: ProviderMetadata | undefined,
  incoming: ProviderMetadata | undefined
): ProviderMetadata | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  const merged: ProviderMetadata = { ...current };
  for (const [provider, value] of Object.entries(incoming)) {
    merged[provider] = { ...(merged[provider] ?? {}), ...value };
  }
  return merged;
}

function failureEvent(
  error: unknown,
  signal: AbortSignal | undefined,
  phase: AiSdkFailurePhase,
  providerClassifier: AiSdkProviderFailureClassifier | undefined,
  diagnosticSink: AiSdkLanguageDiagnosticSink | undefined,
  diagnosticContext: {
    readonly attempt_id: string;
    readonly request_fingerprint: string;
  },
): CanonicalInferenceEvent {
  const observation = projectAiSdkFailureObservation(error, signal, phase, providerClassifier);
  if (observation.failure.kind !== 'aborted') {
    diagnosticSink?.publish({
      type: 'failure_projected',
      ...diagnosticContext,
      phase: observation.diagnostic.phase,
      error_shape: observation.diagnostic.error_shape,
      failure_kind: observation.failure.kind,
      failure_code: observation.failure.code,
      retryable: observation.failure.retryable,
    });
  }
  return { type: 'failure', ...observation.failure };
}

export interface AiSdkInferenceCapabilityDependencies {
  readonly language_models: AiSdkLanguageModelRegistry;
  /** 仅供 Host composition/test 注入；不是 Provider 或模型字段。 */
  readonly stream_idle_timeout_ms?: number;
  /** 产品级 Provider 错误语义由 Host 注入，adapter 不依赖任何产品或账号体系。 */
  readonly provider_failure_classifier?: AiSdkProviderFailureClassifier;
  /** adapter 只发布脱敏诊断事件，日志实现与文案由 Host 决定。 */
  readonly diagnostic_sink?: AiSdkLanguageDiagnosticSink;
}

export function createAiSdkInferenceCapability(
  id: AiSdkInferenceCapabilityId,
  surface: AiSdkInferenceSurface,
  dependencies: AiSdkInferenceCapabilityDependencies
): AiSdkInferenceCapability {
  const streamReliability = resolveAiSdkStreamReliabilityPolicy(
    dependencies.stream_idle_timeout_ms
  );
  const attemptsByTrace = new Map<string, number>();

  const nextRetryCount = (traceId: string): number => {
    const attemptNumber = attemptsByTrace.get(traceId) ?? 0;
    attemptsByTrace.set(traceId, attemptNumber + 1);
    // trace id 在正常 run 中只活跃很短时间；这个上限避免异常调用方长期制造无界 map。
    if (attemptsByTrace.size > 1024) {
      const oldest = attemptsByTrace.keys().next().value;
      if (oldest !== undefined && oldest !== traceId) attemptsByTrace.delete(oldest);
    }
    return attemptNumber;
  };

  return {
    id,
    api_surface: surface,
    async *stream({ request, route, credential }) {
      assertAiSdkInferenceRouteMatchesCapability(route, id, surface);
      const requestDiagnostic: AiSdkRequestDiagnosticSummary =
        projectAiSdkRequestDiagnostic(request);
      const retryCount = nextRetryCount(request.invocation.trace_id);
      const diagnosticContext = {
        attempt_id: request.invocation.attempt_id,
        request_fingerprint: requestDiagnostic.request_fingerprint,
      };
      yield {
        type: 'start',
        model_id: request.model_id,
        attempt_id: request.invocation.attempt_id,
      };

      const toolIndexes = new Map<string, { readonly index: number; readonly partIndex: number }>();
      const reasoningParts = new Map<string, ActiveReasoningPart>();
      const textParts = new Map<string, ActiveTextPart>();
      let nextToolIndex = 0;
      let nextAssistantPartIndex = 0;
      let failurePhase: AiSdkFailurePhase = 'request_projection';
      let deferredProjectionFailure: CanonicalInferenceEvent | undefined;
      let lastProviderPartType: string | undefined;
      let terminalEventReceived = false;
      let terminalEventType: 'finish' | 'failure' | undefined;
      const providerAbortController = new AbortController();
      const forwardRequestAbort = () => providerAbortController.abort(request.signal?.reason);
      if (request.signal?.aborted) {
        forwardRequestAbort();
      } else {
        request.signal?.addEventListener('abort', forwardRequestAbort, { once: true });
      }

      try {
        const toolConfiguration = projectCanonicalToolConfiguration(request);
        const providerOptions = projectAiSdkRequestProviderOptions(request, route);
        const generationSettings = projectAiSdkGenerationSettings(request, route);
        const result = streamText({
          model: dependencies.language_models.languageModel({
            capability_id: id,
            surface,
            endpoint_id: route.endpoint_id,
            endpoint_model_id: route.endpoint_model_id,
            base_url: route.base_url,
            ...(route.headers ? { headers: route.headers } : {}),
            ...(credential ? { credential } : {}),
          }),
          messages: projectCanonicalMessages(request.messages, route, request.cache_policy),
          // 保留 canonical system 顺序交给各 codec；Codex 再按自身合同投影为 instructions。
          allowSystemInMessages: true,
          ...toolConfiguration,
          ...(providerOptions ? { providerOptions } : {}),
          ...generationSettings,
          maxRetries: 0,
          stopWhen: stepCountIs(1),
          includeRawChunks: false,
          abortSignal: providerAbortController.signal,
          timeout: {
            firstChunkMs: streamReliability.idle_timeout_ms,
            chunkMs: streamReliability.idle_timeout_ms,
          },
          // AI SDK 默认会把含 request/response body 的 APICallError 打到 stderr；Host 只投影安全错误分类。
          onError: event => {
            void event.error;
          },
          ...(request.sampling.temperature !== undefined
            ? { temperature: request.sampling.temperature }
            : {}),
          ...(request.sampling.top_p !== undefined ? { topP: request.sampling.top_p } : {}),
        });

        failurePhase = 'provider_stream';
        for await (const part of result.stream) {
          lastProviderPartType = part.type;
          if (deferredProjectionFailure) continue;
          const events: CanonicalInferenceEvent[] = [];
          try {
            switch (part.type) {
              case 'text-start':
                textParts.set(part.id, {
                  index: nextAssistantPartIndex++,
                  text: '',
                  metadata: part.providerMetadata,
                });
                break;
              case 'text-delta': {
                const active = textParts.get(part.id);
                if (!active) {
                  throw new AiSdkHostStreamInvariantError('text_delta_without_start');
                }
                active.text += part.text;
                active.metadata = mergeMetadata(active.metadata, part.providerMetadata);
                if (part.text) events.push({ type: 'answer_delta', text: part.text });
                break;
              }
              case 'text-end': {
                const active = textParts.get(part.id);
                if (!active) {
                  throw new AiSdkHostStreamInvariantError('text_end_without_start');
                }
                if (!active.text) {
                  textParts.delete(part.id);
                  break;
                }
                const continuation = projectAiSdkContinuation(
                  surface,
                  route,
                  mergeMetadata(active.metadata, part.providerMetadata),
                  { type: 'text', text: active.text }
                );
                events.push({
                  type: 'assistant_part_end',
                  index: active.index,
                  part: {
                    type: 'text',
                    text: active.text,
                    ...(continuation ? { continuation: [continuation] } : {}),
                  },
                });
                textParts.delete(part.id);
                break;
              }
              case 'reasoning-start':
                reasoningParts.set(part.id, {
                  index: nextAssistantPartIndex++,
                  text: '',
                  metadata: part.providerMetadata,
                });
                break;
              case 'reasoning-delta': {
                const active = reasoningParts.get(part.id);
                if (!active) {
                  throw new AiSdkHostStreamInvariantError('reasoning_delta_without_start');
                }
                active.text += part.text;
                active.metadata = mergeMetadata(active.metadata, part.providerMetadata);
                if (part.text) events.push({ type: 'thought_delta', text: part.text });
                break;
              }
              case 'reasoning-end': {
                const active = reasoningParts.get(part.id);
                if (!active) {
                  throw new AiSdkHostStreamInvariantError('reasoning_end_without_start');
                }
                const continuation = projectAiSdkContinuation(
                  surface,
                  route,
                  mergeMetadata(active.metadata, part.providerMetadata),
                  { type: 'reasoning', text: active.text }
                );
                events.push({
                  type: 'assistant_part_end',
                  index: active.index,
                  part: {
                    type: 'reasoning',
                    text: active.text,
                    ...(continuation ? { continuation: [continuation] } : {}),
                  },
                });
                reasoningParts.delete(part.id);
                break;
              }
              case 'tool-input-start': {
                const index = nextToolIndex++;
                const partIndex = nextAssistantPartIndex++;
                toolIndexes.set(part.id, { index, partIndex });
                events.push({
                  type: 'tool_call_start',
                  index,
                  part_index: partIndex,
                  id: part.id,
                  name: part.toolName,
                });
                break;
              }
              case 'tool-input-delta': {
                const active = toolIndexes.get(part.id);
                if (!active) {
                  throw new AiSdkHostStreamInvariantError('tool_delta_without_start');
                }
                if (part.delta) {
                  events.push({
                    type: 'tool_argument_delta',
                    index: active.index,
                    json_delta: part.delta,
                  });
                }
                break;
              }
              case 'tool-call': {
                if (part.dynamic && part.invalid) {
                  throw new AiSdkHostStreamInvariantError('invalid_tool_call');
                }
                let active = toolIndexes.get(part.toolCallId);
                if (!active) {
                  active = { index: nextToolIndex++, partIndex: nextAssistantPartIndex++ };
                  toolIndexes.set(part.toolCallId, active);
                  events.push({
                    type: 'tool_call_start',
                    index: active.index,
                    part_index: active.partIndex,
                    id: part.toolCallId,
                    name: part.toolName,
                  });
                }
                const argumentsRecord = toSerializableJsonRecord(part.input);
                if (!argumentsRecord) {
                  throw new AiSdkHostStreamInvariantError('tool_arguments_not_serializable');
                }
                const continuation = projectAiSdkContinuation(
                  surface,
                  route,
                  part.providerMetadata,
                  { type: 'tool_call', tool_call_id: part.toolCallId }
                );
                const call: CanonicalCompletedToolCall = {
                  id: part.toolCallId,
                  name: part.toolName,
                  arguments: argumentsRecord,
                  ...(continuation ? { continuation: [continuation] } : {}),
                };
                events.push({ type: 'tool_call_end', index: active.index, call });
                toolIndexes.delete(part.toolCallId);
                break;
              }
              case 'finish-step': {
                const usage = projectAiSdkUsage(part.usage);
                if (usage) events.push({ type: 'usage', usage });
                break;
              }
              case 'finish': {
                const projection = projectAiSdkFinishReason(
                  part.finishReason,
                  part.rawFinishReason
                );
                events.push(projection.event);
                if (part.finishReason === 'error' || part.finishReason === 'other') {
                  dependencies.diagnostic_sink?.publish({
                    type: 'nonstandard_finish',
                    ...diagnosticContext,
                    capability_id: id,
                    surface,
                    finish_reason: part.finishReason,
                    raw_finish_reason_category: projection.raw_reason_category,
                    projected_event_type: projection.event.type,
                    ...(projection.event.type === 'failure'
                      ? {
                          projected_code: projection.event.code,
                          retryable: projection.event.retryable,
                        }
                      : { projected_reason: projection.event.reason }),
                  });
                }
                break;
              }
              case 'abort':
                if (request.signal?.aborted) {
                  events.push({
                    type: 'failure',
                    kind: 'aborted',
                    code: 'request_aborted',
                    retryable: false,
                  });
                } else {
                  dependencies.diagnostic_sink?.publish({
                    type: 'stream_idle_timeout',
                    ...diagnosticContext,
                    capability_id: id,
                    surface,
                    idle_timeout_ms: streamReliability.idle_timeout_ms,
                  });
                  events.push({
                    type: 'failure',
                    kind: 'transport',
                    code: 'provider_stream_idle_timeout',
                    retryable: true,
                  });
                }
                break;
              case 'error':
                events.push(
                  failureEvent(
                    part.error,
                    request.signal,
                    'provider_stream',
                    dependencies.provider_failure_classifier,
                    dependencies.diagnostic_sink,
                    diagnosticContext,
                  )
                );
                break;
              case 'tool-result':
              case 'tool-error':
              case 'tool-output-denied':
              case 'tool-approval-request':
              case 'tool-approval-response':
                events.push({
                  type: 'failure',
                  kind: 'protocol',
                  code: 'unexpected_ai_sdk_tool_execution',
                  retryable: false,
                });
                break;
              case 'start':
              case 'start-step':
              case 'tool-input-end':
              case 'source':
              case 'file':
              case 'reasoning-file':
              case 'custom':
              case 'raw':
                break;
            }
          } catch (error: unknown) {
            const projectionError = error instanceof AiSdkHostStreamInvariantError
              ? error
              : new AiSdkHostStreamInvariantError('stream_part_projection_failed');
            deferredProjectionFailure = failureEvent(
              projectionError,
              request.signal,
              'provider_stream',
              dependencies.provider_failure_classifier,
              dependencies.diagnostic_sink,
              diagnosticContext,
            );
            // 发现 Host 级协议违规后先终止并排空底层流，避免异步迭代器以空 reason 取消时
            // 留下未处理 rejection；canonical 层只在 wire stream 收口后发布一次失败。
            providerAbortController.abort(projectionError);
            continue;
          }
          for (const event of events) yield event;
          const terminalEvent = events.find(
            (event): event is Extract<CanonicalInferenceEvent, { type: 'finish' | 'failure' }> =>
              event.type === 'finish' || event.type === 'failure',
          );
          if (terminalEvent) {
            terminalEventReceived = true;
            terminalEventType = terminalEvent.type;
            return;
          }
        }
      } catch (error: unknown) {
        if (deferredProjectionFailure) {
          yield deferredProjectionFailure;
          return;
        }
        yield failureEvent(
          error,
          request.signal,
          failurePhase,
          dependencies.provider_failure_classifier,
          dependencies.diagnostic_sink,
          diagnosticContext,
        );
        return;
      } finally {
        dependencies.diagnostic_sink?.publish({
          type: 'attempt_observed',
          attempt_id: request.invocation.attempt_id,
          capability_id: id,
          surface,
          endpoint_id: route.endpoint_id,
          endpoint_model_id: route.endpoint_model_id,
          ...requestDiagnostic,
          retry_count: retryCount,
          terminal_event_received: terminalEventReceived,
          ...(terminalEventType ? { terminal_event_type: terminalEventType } : {}),
          ...(lastProviderPartType ? { last_provider_part_type: lastProviderPartType } : {}),
        });
        request.signal?.removeEventListener('abort', forwardRequestAbort);
      }

      if (deferredProjectionFailure) {
        yield deferredProjectionFailure;
        return;
      }

      yield {
        type: 'failure',
        kind: 'transport',
        code: 'provider_stream_truncated',
        retryable: true,
      };
    },
  };
}
