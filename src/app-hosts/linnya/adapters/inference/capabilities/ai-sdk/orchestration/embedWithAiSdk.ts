import { embedMany } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import type { EmbeddingRequest, EmbeddingResult } from 'src/domains/model-inference';

export interface ResolvedAiSdkEmbeddingRoute {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
}

export interface AiSdkEmbeddingDependencies {
  readonly fetch?: typeof globalThis.fetch;
}

const RawEmbeddingUsageSchema = z.object({ prompt_tokens: z.number() }).passthrough();

export async function embedWithAiSdk(
  route: ResolvedAiSdkEmbeddingRoute,
  request: EmbeddingRequest,
  dependencies: AiSdkEmbeddingDependencies = {},
): Promise<EmbeddingResult> {
  const provider = createOpenAICompatible({
    name: route.providerId,
    baseURL: route.baseUrl,
    apiKey: route.apiKey,
    fetch: dependencies.fetch,
  });
  const result = await embedMany({
    model: provider.embeddingModel(route.providerModelId),
    values: [...request.values],
    maxRetries: 0,
    maxParallelCalls: request.maxParallelCalls ?? 1,
    abortSignal: request.signal,
  });
  const raw = (result.responses ?? []).flatMap(response => {
    const body = response?.body;
    if (!body || typeof body !== 'object' || !('usage' in body)) return [];
    const parsed = RawEmbeddingUsageSchema.safeParse(body.usage);
    return parsed.success ? [parsed.data] : [];
  });
  const inputTokens = raw.length > 0
    ? raw.reduce((total, usage) => total + usage.prompt_tokens, 0)
    : undefined;
  return {
    vectors: result.embeddings,
    ...(raw.length > 0
      ? { usage: { ...(inputTokens === undefined ? {} : { inputTokens }), raw } }
      : {}),
  };
}
