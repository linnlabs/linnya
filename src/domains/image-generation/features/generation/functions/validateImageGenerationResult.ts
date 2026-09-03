import {
  ImageGenerationFailure,
  type ImageGenerationResult,
} from '../definitions/imageGeneration';

export function validateImageGenerationResult(
  requestedCount: number,
  result: ImageGenerationResult,
): void {
  if (result.images.length !== requestedCount) {
    throw new ImageGenerationFailure(
      'protocol',
      'image_count_mismatch',
      false,
      `Provider 返回 ${result.images.length} 张图片，但请求数量为 ${requestedCount}`,
    );
  }
  if (result.images.some(image => image.bytes.byteLength === 0)) {
    throw new ImageGenerationFailure(
      'protocol',
      'image_bytes_empty',
      false,
      'Provider 返回了空图片数据',
    );
  }
}
