/**
 * @file src/tools/image_generation/GenerateImageTool.ts
 *
 * @brief 文本生成图片工具
 *
 * @description
 * 根据文本描述生成图片，支持多种参数配置。
 * 生成的图片会自动保存到指定目录并返回相关信息。
 */

import {
  CONVERSATION_IMAGE_MAX_BYTES,
  ImageGenerationArgsSchema,
  ImageGenerationResultSchema,
  type ImageGenerationMedia,
} from '@app/schemas';
import {
  BaseTool,
  ToolParameterSchema,
  type ToolArgs,
  type ToolContext,
  type LinnyaToolSchemaContext,
} from '../types';
import { ASSET_IMAGE_MAX_PIXELS } from '../../domains/assets/definitions/imageAssetPolicy';
import type { SavedGeneratedImageInfo } from '../../domains/assets/features/generated-image-publication';
import { modelCatalog } from 'src/domains/model-catalog';
import { generateAndPublishImages } from 'src/app-hosts/linnya/application/image-generation';
import { ImageGenerationModelNotConfiguredError } from './definitions/imageGenerationToolFailure';
import path from 'node:path';

/**
 * 工具层暴露的常用尺寸选项（用于引导 LLM/前端选择）
 *
 * 中文备注：
 * - 某些图片生成模型会要求更大的最小像素数（例如 >= 3686400），因此这里补充了常见的大尺寸；
 * - Provider 调用前会按模型目录约束做严格准入，不会静默改写尺寸或根据上游报错重试。
 */
const IMAGE_GENERATION_SUPPORTED_SIZES = [
  '256x256',
  '512x512',
  '768x768',
  '1024x1024',
  '1152x1152',
  '1536x1536',
  '1920x1920',
  '2048x2048',
  '1024x1792',
  '1792x1024',
  '1080x1920',
  '1920x1080',
  '1440x2560',
  '2560x1440',
] as const;

const GENERATED_IMAGE_MODEL_INPUT_REQUIREMENT = Object.freeze({
  requires_image_input: true,
  placements: Object.freeze(['tool_result_image'] as const),
});

function buildImageMedia(savedImages: readonly SavedGeneratedImageInfo[]): ImageGenerationMedia[] {
  return savedImages.map(image => ({
    path: image.filePath,
    media_type: image.mediaType,
    width: image.width,
    height: image.height,
  }));
}

export function toConversationImageLocator(conversationRoot: string, filePath: string): string {
  const relativePath = path.relative(conversationRoot, filePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Generated image escaped the conversation workspace: ${filePath}`);
  }
  return `conversation:/${relativePath.split(path.sep).join('/')}`;
}

async function issueGeneratedImageClaims(
  context: ToolContext,
  savedImages: readonly SavedGeneratedImageInfo[]
): Promise<
  { readonly attachments: readonly { readonly id: string; readonly uri: string }[] } | undefined
> {
  if (savedImages.length === 0) return undefined;
  const conversationId = context.conversationId?.trim();
  const toolCallId = context.parentToolCallId;
  const ingress = context.managedImageIngress;
  const claims = context.toolResultAssetClaims;
  if (!conversationId || !toolCallId || !ingress || !claims) {
    throw new Error('generate_image requires the host-managed conversation image claim ports.');
  }

  const registered = await Promise.all(
    savedImages.map(image =>
      ingress.ingestLocalImage({
        sourcePath: image.filePath,
        createdAt: image.createdAt,
      })
    )
  );
  const issued = claims.issueClaims({
    conversationId,
    toolCallId,
    selections: registered.map(asset => ({
      selectionId: `generate-image:${asset.assetId}`,
      assetId: asset.assetId,
    })),
  });
  return {
    attachments: issued.map(item => ({ id: item.selectionId, uri: item.uri })),
  };
}

async function generateImagesInConversationWorkspace(
  context: ToolContext,
  modelId: string,
  prompt: string,
  options: { readonly size: string; readonly n: number }
): Promise<{ readonly rootPath: string; readonly images: readonly SavedGeneratedImageInfo[] }> {
  const conversationId = context.conversationId?.trim();
  const admission = context.conversationWorkDirectoryAdmission;
  if (!conversationId || !admission) {
    throw new Error('generate_image requires a host-managed conversation work directory.');
  }
  return admission.withAdmission({ conversationId }, async directory => ({
    rootPath: directory.absolutePath,
    images: await generateAndPublishImages({
      modelId,
      prompt,
      size: options.size,
      count: options.n,
      outputDir: path.join(directory.absolutePath, 'generated-images'),
      policy: {
        maxImageBytes: CONVERSATION_IMAGE_MAX_BYTES,
        maxImagePixels: ASSET_IMAGE_MAX_PIXELS,
      },
    }),
  }));
}

/**
 * 文本生成图片工具
 * 根据文本描述生成图片
 */
export class GenerateImageTool extends BaseTool {
  readonly name = 'generate_image';
  readonly modelInputRequirement = GENERATED_IMAGE_MODEL_INPUT_REQUIREMENT;
  readonly modelInputDelivery = 'when_supported' as const;
  readonly streaming = {
    emitPlaceholder: true,
    emitArgumentSnapshots: true,
  } as const;

  get description() {
    return `Generate images from text descriptions. This tool can create visual content based on detailed text prompts.

# When to Use
- When the user requests image generation or visual content creation.
- When you need to create illustrations for explanations or examples.
- When the user asks to visualize concepts, objects, scenes, or ideas.

# Note
- The prompt should contain " No text" if you don't want to generate text in the image.

# Output
Returns images on the screen.`;
  }

  /**
   * 根据本次 Host 调用中的图片生成模型绑定动态生成参数 schema
   *
   * 中文备注：
   * - 目标是：只要在模型配置里写 `image_generation.allowed_sizes`，
   *   tool 的 `size.enum` 就能自动变成该模型允许/推荐的尺寸集合；
   * - 这样无需在工具里为每个模型硬编码尺寸列表。
   */
  getParametersForContext(context: LinnyaToolSchemaContext): ToolParameterSchema {
    const modelId = context.imageGenerationModelId;

    const cfg = modelId ? modelCatalog.getModel(modelId) : undefined;
    const imageGenCfg = cfg?.image_generation;
    const normalizedAllowedSizes = imageGenCfg?.allowed_sizes
      ?.map(value => value.trim())
      .filter(value => value.length > 0);
    const allowedSizes =
      normalizedAllowedSizes && normalizedAllowedSizes.length > 0
        ? normalizedAllowedSizes
        : undefined;
    const minPixels = imageGenCfg?.min_pixels;
    const maxPixels = imageGenCfg?.max_pixels;

    const sizeEnum = allowedSizes ?? [...IMAGE_GENERATION_SUPPORTED_SIZES];

    const defaultSize = (() => {
      // Doubao 文档默认 2048x2048
      if (sizeEnum.includes('2048x2048')) return '2048x2048';
      if (sizeEnum.includes('1024x1024')) return '1024x1024';
      return sizeEnum[0] || '1024x1024';
    })();

    const sizeDescLines: string[] = [
      modelId
        ? `Image size. Options are model-specific (current model: ${modelId}).`
        : 'Image size. A configured image generation model is required at execution time.',
      `Common preset options: ${sizeEnum.join(', ')}.`,
      `Default: ${defaultSize}.`,
    ];
    if (typeof minPixels === 'number' || typeof maxPixels === 'number') {
      sizeDescLines.push(
        `Model constraints: ${typeof minPixels === 'number' ? `min_pixels=${minPixels}` : ''}${typeof minPixels === 'number' && typeof maxPixels === 'number' ? ', ' : ''}${typeof maxPixels === 'number' ? `max_pixels=${maxPixels}` : ''}.`
      );
    }
    sizeDescLines.push('The selected size must satisfy the current model constraints.');

    return {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Detailed description of the image to generate. Be specific and descriptive for better results.',
        },
        size: {
          type: 'string',
          description: sizeDescLines.join('\n'),
          enum: sizeEnum,
          default: defaultSize,
        },
        n: {
          type: 'integer',
          description: 'Number of images to generate (1-4). Default: 1.',
          default: 1,
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    };
  }

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'Detailed description of the image to generate. Be specific and descriptive for better results.',
      },
      size: {
        type: 'string',
        description: `Image size. Common options: ${IMAGE_GENERATION_SUPPORTED_SIZES.join(', ')}. Default: 1024x1024.

Note: The selected size must satisfy the current model constraints.`,
        enum: [...IMAGE_GENERATION_SUPPORTED_SIZES],
        default: '1024x1024',
      },
      n: {
        type: 'integer',
        description: 'Number of images to generate (1-4). Default: 1.',
        default: 1,
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  };

  /**
   * 为工具的执行结果生成一个简洁的摘要。
   *
   * @功能 (What): 这个方法为图片生成工具的执行结果创建一个简短的文本摘要。
   * 这个摘要用于历史记录压缩，以节省 token，同时保留关键信息。
   *
   * @输入 (Input / @param):
   *   - `output`: `run` 返回的严格 `ImageGenerationResult` JSON 字符串。
   *
   * @输出 (Output / @returns):
   *   - 返回一个人类可读的字符串，总结了图片生成操作的结果。
   *     - 返回“成功生成了 N 张图片。”；影子裸路径输出不属于工具合同，不做兼容。
   *
   * @副作用 (Side-effects): 无。
   */
  getExecutionSummary(output: string): string {
    const parsed = ImageGenerationResultSchema.parse(JSON.parse(output));
    const count = typeof parsed.data === 'string' ? 1 : parsed.data.length;
    return `成功生成了 ${count} 张图片。`;
  }

  /**
   * 执行图片生成
   * @param rawArgs 工具参数
   * @param context 执行上下文
   * @returns 结构化的执行结果
   */
  async run(rawArgs: ToolArgs, context: ToolContext): Promise<string> {
    const args = ImageGenerationArgsSchema.parse(rawArgs);
    const { prompt, size, n } = args;

    const imageGenerationModelId = context.imageGenerationModelId?.trim();
    if (!imageGenerationModelId) {
      throw new ImageGenerationModelNotConfiguredError();
    }

    const generated = await generateImagesInConversationWorkspace(
      context,
      imageGenerationModelId,
      prompt,
      {
        size,
        n,
      }
    );
    const savedImages = generated.images;
    const locators = savedImages.map(image =>
      toConversationImageLocator(generated.rootPath, image.filePath)
    );
    const media = buildImageMedia(savedImages);
    // 生成是主结果，回图只是增强反馈。只有 ToolNode 已按真实 active model 明确准入时才登记受管副本。
    const modelInput =
      context.modelInputAdmission?.admitted === true
        ? await issueGeneratedImageClaims(context, savedImages)
        : undefined;

    // Agent 只接收会话工作区相对路径；renderer 展示所需的物理路径只存在于 presentation metadata。
    if (savedImages.length === 1) {
      const locator = locators[0];
      return JSON.stringify(
        ImageGenerationResultSchema.parse({
          data: locator,
          ...(media.length > 0 ? { media } : {}),
          ...(modelInput ? { modelInput } : {}),
          observation:
            `**Successfully generated!** The image for prompt "${prompt}" is rendered to the user.\n` +
            `image_locator: ${locator}\n` +
            `后续工具可用 read_file(locator=image_locator) 或 Shell/CLI 继续处理。\n` +
            `注意：路径是给后续工具用的，不要在给用户的回复正文里直接念出来。`,
        })
      );
    }

    const imageLocators = locators;
    const locatorListText = imageLocators
      .map((locator, index) => `  [${index}] ${locator}`)
      .join('\n');
    return JSON.stringify(
      ImageGenerationResultSchema.parse({
        data: imageLocators,
        ...(media.length > 0 ? { media } : {}),
        ...(modelInput ? { modelInput } : {}),
        observation:
          `**Successfully generated!** ${savedImages.length} images for prompt "${prompt}" are rendered to the user.\n` +
          `image_locators:\n${locatorListText}\n` +
          `后续工具可分别用 read_file(locator=image_locator) 或 Shell/CLI 继续处理。\n` +
          `注意：路径是给后续工具用的，不要在给用户的回复正文里直接念出来。`,
      })
    );
  }
}
