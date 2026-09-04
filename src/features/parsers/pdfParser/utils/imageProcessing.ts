/** PDF 视觉路径在进入正式端口前使用的轻量校验。 */

import { normalizePdfRasterTargetPixels } from '../definitions/pdfRaster';

/** 验证不带 data URL 前缀的 Base64 图像载荷。 */
export function validateImageData(imageBase64: string): boolean {
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return false;
  }

  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(imageBase64) && imageBase64.length > 100;
}

/** 与 PDF 栅格化合同共用同一尺寸边界，避免调用方保留另一套上限。 */
export function validateTargetPixels(targetPixels: number): number {
  return normalizePdfRasterTargetPixels(targetPixels);
}
