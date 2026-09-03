import { IMAGE_GENERATION_TOOL_ERROR_CODES } from '@app/schemas';

export { IMAGE_GENERATION_TOOL_ERROR_CODES } from '@app/schemas';

/** 当前请求没有绑定图片生成模型时的稳定工具失败。 */
export class ImageGenerationModelNotConfiguredError extends Error {
  readonly code = IMAGE_GENERATION_TOOL_ERROR_CODES.modelNotConfigured;

  constructor() {
    super('尚未配置图片生成模型，请提醒用户配置。');
    this.name = 'ImageGenerationModelNotConfiguredError';
  }
}
