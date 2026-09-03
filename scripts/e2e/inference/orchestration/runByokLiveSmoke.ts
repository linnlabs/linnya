import type {
  CanonicalAssistantReplayPart,
  CanonicalInferenceEvent,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';

import { createLinnyaAiSdkInferenceCapability } from '../../../../src/app-hosts/linnya/adapters/inference/features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkInferenceCapability';
import { createLinnyaAiSdkLanguageModelRegistry } from '../../../../src/app-hosts/linnya/adapters/inference/features/ai-sdk-language-composition/orchestration/createLinnyaAiSdkLanguageModelRegistry';
import type { ResolvedInferenceAttemptRoute } from '../../../../src/app-hosts/linnya/adapters/inference/definitions/inferenceCapability';
import type { ByokLiveSmokeConfiguration, ByokLiveSmokeTarget } from '../definitions/byokLiveSmoke';

function route(target: ByokLiveSmokeTarget): ResolvedInferenceAttemptRoute {
  return {
    model_id: `byok-smoke-${target.id}`,
    capability_id: target.capability_id,
    endpoint_id: target.endpoint_id,
    endpoint_model_id: target.endpoint_model_id,
    api_surface: target.surface,
    base_url: target.base_url,
    auth_profile: target.auth_profile,
    context_window_tokens: 128_000,
    max_output_tokens: 512,
    input_support: { user_image: false, tool_result_image: false },
    usage: { response_usage: 'provider_reported_optional' },
    continuation: { tool_replay: 'optional' },
  };
}

function firstRequest(resolvedRoute: ResolvedInferenceAttemptRoute): CanonicalInferenceRequest {
  return {
    model_id: resolvedRoute.model_id,
    messages: [{
      role: 'user',
      content: [{
        type: 'text',
        text: 'Call report_status exactly once with status "OK". After receiving its result, reply with exactly OK.',
      }],
    }],
    tools: [{
      name: 'report_status',
      description: 'Report the requested smoke-test status.',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', description: 'The status to report.' } },
        required: ['status'],
        additionalProperties: false,
      },
    }],
    tool_choice: { type: 'tool', name: 'report_status' },
    sampling: { temperature: 0, max_output_tokens: 256 },
    invocation: {
      trace_id: `byok-live-smoke-${resolvedRoute.endpoint_id}`,
      attempt_id: 'attempt-1',
    },
  };
}

function replayParts(events: readonly CanonicalInferenceEvent[]): CanonicalAssistantReplayPart[] {
  const parts: Array<{ readonly index: number; readonly part: CanonicalAssistantReplayPart }> = [];
  const toolPartIndexes = new Map<number, number>();
  for (const event of events) {
    if (event.type === 'assistant_part_end') {
      parts.push({ index: event.index, part: event.part });
    } else if (event.type === 'tool_call_start') {
      toolPartIndexes.set(event.index, event.part_index);
    } else if (event.type === 'tool_call_end') {
      const partIndex = toolPartIndexes.get(event.index);
      if (partIndex === undefined) {
        throw new Error('BYOK live smoke 收到缺少 start 的工具调用。');
      }
      parts.push({ index: partIndex, part: { type: 'tool_call', call: event.call } });
    }
  }
  return parts.sort((left, right) => left.index - right.index).map(entry => entry.part);
}

async function collectEvents(
  stream: AsyncIterable<CanonicalInferenceEvent>
): Promise<CanonicalInferenceEvent[]> {
  const events: CanonicalInferenceEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function assertSuccessfulEvents(
  target: ByokLiveSmokeTarget,
  events: readonly CanonicalInferenceEvent[],
  turn: 'tool' | 'follow-up'
): void {
  const failure = events.find(
    (event): event is Extract<CanonicalInferenceEvent, { type: 'failure' }> =>
      event.type === 'failure'
  );
  if (failure) {
    throw new Error(`${target.name} ${turn} live smoke 失败：${failure.kind}/${failure.code}`);
  }
  if (!events.some(event => event.type === 'usage')) {
    throw new Error(`${target.name} ${turn} live smoke 没有 Provider usage。`);
  }
  if (!events.some(event => event.type === 'finish')) {
    throw new Error(`${target.name} ${turn} live smoke 没有正常结束。`);
  }
}

async function runTarget(
  target: ByokLiveSmokeTarget,
  fetchImplementation: typeof fetch
): Promise<void> {
  let requestCount = 0;
  const countingFetch: typeof fetch = async (input, init) => {
    requestCount += 1;
    return fetchImplementation(input, init);
  };
  const resolvedRoute = route(target);
  const capability = createLinnyaAiSdkInferenceCapability(target.capability_id, target.surface, {
    language_models: createLinnyaAiSdkLanguageModelRegistry(countingFetch),
  });
  const initialRequest = firstRequest(resolvedRoute);
  const credential = { profile: target.auth_profile, secret: target.credential } as const;
  const firstEvents = await collectEvents(capability.stream({
    request: initialRequest,
    route: resolvedRoute,
    credential,
  }));
  assertSuccessfulEvents(target, firstEvents, 'tool');

  const toolCalls = firstEvents.filter(
    (event): event is Extract<CanonicalInferenceEvent, { type: 'tool_call_end' }> =>
      event.type === 'tool_call_end'
  );
  if (toolCalls.length !== 1 || toolCalls[0]?.call.name !== 'report_status') {
    throw new Error(`${target.name} live smoke 没有产生唯一 report_status 工具调用。`);
  }
  const replay = replayParts(firstEvents);
  const secondRequest: CanonicalInferenceRequest = {
    ...initialRequest,
    messages: [
      ...initialRequest.messages,
      { role: 'assistant', parts: replay },
      {
        role: 'tool',
        tool_call_id: toolCalls[0].call.id,
        content: [{ type: 'text', text: '{"status":"OK"}' }],
      },
    ],
    tools: [],
    tool_choice: 'none',
    sampling: { temperature: 0, max_output_tokens: 64 },
    invocation: {
      trace_id: `byok-live-smoke-${resolvedRoute.endpoint_id}`,
      attempt_id: 'attempt-2',
    },
  };
  const secondEvents = await collectEvents(capability.stream({
    request: secondRequest,
    route: resolvedRoute,
    credential,
  }));
  assertSuccessfulEvents(target, secondEvents, 'follow-up');
  if (!secondEvents.some(event => event.type === 'answer_delta')) {
    throw new Error(`${target.name} follow-up live smoke 没有产生正文。`);
  }
  if (requestCount !== 2) {
    throw new Error(`${target.name} live smoke 预期 2 次 Provider 请求，实际 ${requestCount} 次。`);
  }
}

export async function runByokLiveSmoke(
  configuration: ByokLiveSmokeConfiguration,
  write: (message: string) => void,
  fetchImplementation: typeof fetch = fetch
): Promise<void> {
  for (const target of configuration.targets) {
    write(`[BYOK live smoke] 开始验证 ${target.name}`);
    await runTarget(target, fetchImplementation);
    write(`[BYOK live smoke] ${target.name} 两轮工具闭环通过`);
  }
}
