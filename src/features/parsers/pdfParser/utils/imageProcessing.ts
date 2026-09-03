/**
 * @file src/parsers/pdfParser/utils/imageProcessing.ts
 * 
 * **功能 (What):** PDF解析相关的图像处理工具函数
 * **输入 (Input):** 图像参数或验证条件
 * **输出 (Output):** 验证结果或处理状态
 * **副作用 (Side-effects):** 无副作用，纯函数工具集
 * 
 * 注意：
 * - PDF转图片的核心功能已迁移到 PdfToImgAdapter.ts
 * - Token计算功能已迁移到 shared/utils/tokenUtils.ts
 */

// 🔥 此文件现在专注于PDF图像处理相关的验证和状态检查
// 如果需要token计算，请使用: import { calculateVisionTokensForOurImages, estimateTextTokens } from '../../shared/utils/tokenUtils'

// sharp 用静态 import（编译为 CJS require）：生产 bytenode 字节码不支持动态 import()，
// 后端生产 bundle 使用 CJS；bytenode 字节码不支持这里改成动态 import()。
import sharp from 'sharp';

/**
 * **功能 (What):** 验证图像数据是否有效
 * **输入 (Input / @param):** 
 * @param imageBase64 - base64编码的图像数据
 * **输出 (Output / @returns):** 是否为有效的图像数据
 * **副作用 (Side-effects):** 无副作用，纯验证函数
 */
export function validateImageData(imageBase64: string): boolean {
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return false;
  }
  
  // 检查base64格式
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(imageBase64) && imageBase64.length > 100; // 至少100字符才可能是有效图片
}

/**
 * **功能 (What):** 检查目标像素数是否在合理范围内
 * **输入 (Input / @param):** 
 * @param targetPixels - 目标像素数
 * **输出 (Output / @returns):** 调整后的像素数
 * **副作用 (Side-effects):** 无副作用，纯函数
 */
export function validateTargetPixels(targetPixels: number): number {
  const MIN_PIXELS = 256;
  const MAX_PIXELS = 2048;
  
  if (targetPixels < MIN_PIXELS) {
    console.warn(`[ImageProcessing] 目标像素 ${targetPixels} 过小，调整为 ${MIN_PIXELS}`);
    return MIN_PIXELS;
  }
  
  if (targetPixels > MAX_PIXELS) {
    console.warn(`[ImageProcessing] 目标像素 ${targetPixels} 过大，调整为 ${MAX_PIXELS}`);
    return MAX_PIXELS;
  }
  
  return targetPixels;
}

/**
 * **功能 (What):** 获取图像的尺寸信息
 * **输入 (Input / @param):** 
 * @param imageBuffer - 图像缓冲区
 * **输出 (Output / @returns):** 图像尺寸信息
 * **副作用 (Side-effects):** 使用sharp库分析图像
 */
export async function getImageDimensions(imageBuffer: Buffer): Promise<{
  width: number;
  height: number;
  format: string;
  size: number;
}> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
      format: metadata.format || 'unknown',
      size: imageBuffer.length
    };
  } catch (error) {
    throw new Error(`获取图像尺寸失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * **功能 (What):** 调试日志控制器
 * **输入 (Input / @param):** 日志消息
 * **输出 (Output):** 无返回值
 * **副作用 (Side-effects):** 根据环境变量输出调试日志
 */
export const debugLog = (message: string): void => {
  if (process.env.PDF_IMG_DEBUG === '1') {
    console.log(message);
  }
};

/**
 * **功能 (What):** 检查图像尺寸是否超出目标阈值
 * **输入 (Input / @param):** 
 * @param width - 图像宽度
 * @param height - 图像高度
 * @param targetPixels - 目标像素数
 * @param tolerance - 容差百分比（默认0.05即5%）
 * **输出 (Output / @returns):** 是否需要调整尺寸
 * **副作用 (Side-effects):** 无副作用，纯函数
 */
export function shouldResizeImage(
  width: number, 
  height: number, 
  targetPixels: number, 
  tolerance: number = 0.05
): boolean {
  const longestSide = Math.max(width, height);
  return longestSide > targetPixels * (1 + tolerance);
}

/**
 * **功能 (What):** 计算图像缩放参数
 * **输入 (Input / @param):** 
 * @param width - 原始宽度
 * @param height - 原始高度
 * @param targetPixels - 目标像素数
 * **输出 (Output / @returns):** Sharp缩放参数
 * **副作用 (Side-effects):** 无副作用，纯函数
 */
export function calculateResizeOptions(width: number, height: number, targetPixels: number): {
  width: number;
  height: number;
  fit: 'inside';
  withoutEnlargement: boolean;
} {
  return {
    width: targetPixels,
    height: targetPixels,
    fit: 'inside' as const,
    withoutEnlargement: true
  };
}

// 🔥 移除未使用的函数：validateImageBuffer, detectImageFormat, calculateAspectRatio, isPortrait
// 如需要可以再次添加

/**
 * **功能 (What):** 计算图像文件大小（KB）
 * **输入 (Input / @param):** 
 * @param buffer - 图像缓冲区
 * **输出 (Output / @returns):** 文件大小（KB）
 * **副作用 (Side-effects):** 无副作用，纯函数
 */
export function getImageSizeInKB(buffer: Buffer): number {
  return Math.round((buffer.length / 1024) * 100) / 100; // 保留两位小数
}
