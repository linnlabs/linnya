import { Buffer } from 'node:buffer';
import {
  publishGeneratedImage,
  type GeneratedImagePublicationPolicy,
  type SavedGeneratedImageInfo,
} from 'src/domains/assets/features/generated-image-publication';
import type { ImageGenerationPort } from 'src/domains/image-generation';
import { createImageGenerationPort } from '../../../adapters/image-generation';

export interface GenerateAndPublishImagesInput {
  readonly modelId: string;
  readonly prompt: string;
  readonly size: string;
  readonly count: number;
  readonly outputDir: string;
  readonly policy: GeneratedImagePublicationPolicy;
  readonly signal?: AbortSignal;
}

export interface ImageGenerationUseCaseDependencies {
  readonly imageGeneration?: ImageGenerationPort;
}

/**
 * 这是 Image Generation 与 Assets 的 app-level 协作边界：前者返回 Provider-neutral 字节，
 * 后者建立媒体身份并发布；任何一侧都不反向依赖另一 domain。
 */
export async function generateAndPublishImages(
  input: GenerateAndPublishImagesInput,
  dependencies: ImageGenerationUseCaseDependencies = {},
): Promise<readonly SavedGeneratedImageInfo[]> {
  const imageGeneration = dependencies.imageGeneration ?? createImageGenerationPort();
  const generated = await imageGeneration.generate({
    modelId: input.modelId,
    prompt: input.prompt,
    size: input.size,
    count: input.count,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return Promise.all(generated.images.map(image => publishGeneratedImage({
    bytes: Buffer.from(image.bytes),
    outputDir: input.outputDir,
    originalPrompt: input.prompt,
    model: generated.model,
    policy: input.policy,
  })));
}
