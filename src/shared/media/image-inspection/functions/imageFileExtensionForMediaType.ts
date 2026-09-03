import type { SupportedImageMediaType } from '../definitions/imageInspection';

/**
 * 图片扩展名必须由已经验证的媒体事实生成，禁止由来源 URL 或旧文件名反推。
 */
export function imageFileExtensionForMediaType(
  mediaType: SupportedImageMediaType,
): 'jpg' | 'png' | 'webp' {
  switch (mediaType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
}
