import { rerank } from 'ai';
import { createCohere } from '@ai-sdk/cohere';
import { z } from 'zod';
import type { RerankingRequest, RerankingResult } from 'src/domains/model-inference';

export interface ResolvedAiSdkRerankingRoute {
  readonly providerModelId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

export interface AiSdkRerankingDependencies {
  readonly fetch?: typeof globalThis.fetch;
}

const RawRerankingUsageSchema = z.object({
  billed_units: z.object({ search_units: z.number().optional() }).passthrough().optional(),
  tokens: z.object({ input_tokens: z.number().optional() }).passthrough().optional(),
}).passthrough();

export async function rerankWithAiSdk(
  route: ResolvedAiSdkRerankingRoute,
  request: RerankingRequest,
  dependencies: AiSdkRerankingDependencies = {},
): Promise<RerankingResult> {
  const provider = createCohere({
    baseURL: route.baseUrl,
    apiKey: route.apiKey,
    fetch: dependencies.fetch,
  });
  const result = await rerank({
    model: provider.reranking(route.providerModelId),
    query: request.query,
    documents: [...request.documents],
    topN: request.topN,
    maxRetries: 0,
    abortSignal: request.signal,
  });
  const body = result.response?.body;
  const rawUsage = body && typeof body === 'object' && 'meta' in body
    ? RawRerankingUsageSchema.safeParse(body.meta)
    : undefined;
  const usage = rawUsage?.success ? rawUsage.data : undefined;
  const inputTokens = usage?.tokens?.input_tokens;
  return {
    ranking: result.ranking.map(item => ({
      originalIndex: item.originalIndex,
      score: item.score,
    })),
    ...(usage ? { usage: { ...(inputTokens === undefined ? {} : { inputTokens }), raw: usage } } : {}),
  };
}
