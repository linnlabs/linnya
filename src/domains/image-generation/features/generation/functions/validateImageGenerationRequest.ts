import {
  ImageGenerationFailure,
  type ImageGenerationRequest,
} from '../definitions/imageGeneration';

export function validateImageGenerationRequest(request: ImageGenerationRequest): void {
  if (!request.prompt.trim()) {
    throw new ImageGenerationFailure(
      'protocol',
      'image_prompt_empty',
      false,
      '图片生成提示词不能为空',
    );
  }
  if (!Number.isSafeInteger(request.count) || request.count < 1 || request.count > 4) {
    throw new ImageGenerationFailure(
      'protocol',
      'image_count_invalid',
      false,
      '图片生成数量必须是 1 到 4 的安全整数',
    );
  }
}
