import { generateImage } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ImageGenerationRequest, ImageGenerationResult } from 'src/domains/image-generation';
import { toAiSdkPixelSize } from 'src/domains/image-generation';

export interface ResolvedAiSdkImageGenerationRoute {
  readonly providerId: string;
  readonly providerModelId: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly responseFormat: 'b64_json';
  readonly maxImagesPerCall: number;
}

export interface AiSdkImageGenerationDependencies {
  readonly fetch?: typeof globalThis.fetch;
}

export async function generateImageWithAiSdk(
  route: ResolvedAiSdkImageGenerationRoute,
  request: ImageGenerationRequest,
  dependencies: AiSdkImageGenerationDependencies = {}
): Promise<ImageGenerationResult> {
  const provider = createOpenAICompatible({
    name: route.providerId,
    baseURL: route.baseUrl,
    apiKey: route.apiKey,
    ...(route.headers ? { headers: { ...route.headers } } : {}),
    fetch: dependencies.fetch,
  });
  const pixelSize = toAiSdkPixelSize(request.size);
  const providerOptionsKey = route.providerId
    .split('.')[0]
    .trim()
    .replace(/[_-]([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const result = await generateImage({
    model: provider.imageModel(route.providerModelId),
    prompt: request.prompt,
    n: request.count,
    maxImagesPerCall: route.maxImagesPerCall,
    ...(pixelSize ? { size: pixelSize } : {}),
    providerOptions: {
      [providerOptionsKey]: {
        response_format: route.responseFormat,
        // `2K/4K` 是 Provider 正式枚举，不满足 AI SDK 通用 WxH 类型时由 provider options 传递。
        ...(pixelSize ? {} : { size: request.size }),
      },
    },
    maxRetries: 0,
    abortSignal: request.signal,
  });
  return {
    model: route.providerModelId,
    images: result.images.map(image => ({ bytes: image.uint8Array })),
  };
}
