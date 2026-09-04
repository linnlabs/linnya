/**
 * @file src/parsers/pdfParser/factory.ts
 *
 * **功能 (What):** PDF解析器工厂函数
 * **输入 (Input):** 配置选项
 * **输出 (Output):** PDF解析器实例
 * **副作用 (Side-effects):** 创建新的解析器实例
 */

import { PdfParser } from './PdfParser';
import { PdfParserOptions } from './types';
import { PDF_RASTER_DEFAULT_TARGET_PIXELS } from './definitions/pdfRaster';
import type { TextGenerationPort } from 'src/domains/model-inference';

/**
 * **功能 (What):** 创建PDF解析器工厂函数
 * **输入 (Input / @param):**
 * @param options - PDF解析器配置选项
 * **输出 (Output / @returns):** PDF解析器实例
 * **副作用 (Side-effects):** 创建新的解析器实例
 */
export function createPdfParser(options: PdfParserOptions = {}): PdfParser {
  return new PdfParser(options);
}

/**
 * **功能 (What):** 创建针对简单文档优化的PDF解析器
 * **输入 (Input / @param):**
 * @param options - 基础配置选项
 * **输出 (Output / @returns):** 优化的PDF解析器实例
 * **副作用 (Side-effects):** 创建新的解析器实例
 */
export function createSimplePdfParser(options: Partial<PdfParserOptions> = {}): PdfParser {
  return new PdfParser({
    ...options,
    forceVisionMode: false,
    targetPixels: 1024, // 较低分辨率，适合简单文档
    maxRetries: 3,
  });
}

/**
 * **功能 (What):** 创建不启用视觉能力的自动分层PDF解析器
 * **输入 (Input / @param):**
 * @param options - 额外配置选项
 * **输出 (Output / @returns):** 仅启用文本和几何提取的PDF解析器实例
 * **副作用 (Side-effects):** 创建解析器实例
 */
export function createAutoPdfParser(options: Partial<PdfParserOptions> = {}): PdfParser {
  return new PdfParser({
    ...options,
    textGeneration: undefined,
    visionModelId: '',
    forceVisionMode: false,
    targetPixels: PDF_RASTER_DEFAULT_TARGET_PIXELS, // 平衡质量和内存峰值
    maxRetries: 5,
  });
}

/**
 * **功能 (What):** 创建支持AI视觉后备的智能PDF解析器
 * **输入 (Input / @param):**
 * @param textGeneration - 非 Agent 文本生成端口（可选）
 * @param visionModelId - 视觉模型ID（可选）
 * @param options - 额外配置选项
 * **输出 (Output / @returns):** 智能PDF解析器实例
 * **副作用 (Side-effects):** 创建支持AI后备的解析器实例
 */
export function createSmartPdfParser(
  textGeneration?: TextGenerationPort,
  visionModelId?: string,
  options: Partial<PdfParserOptions> = {}
): PdfParser {
  return new PdfParser({
    ...options,
    textGeneration,
    visionModelId: visionModelId || '',
    forceVisionMode: false, // 先尝试传统方法，失败时自动降级到AI
    targetPixels: PDF_RASTER_DEFAULT_TARGET_PIXELS, // 平衡质量和内存峰值
    maxRetries: 5,
  });
}

/**
 * **功能 (What):** 创建针对学术论文优化的PDF解析器
 * **输入 (Input / @param):**
 * @param options - 基础配置选项
 * **输出 (Output / @returns):** 优化的PDF解析器实例
 * **副作用 (Side-effects):** 创建新的解析器实例
 */
export function createAcademicPdfParser(options: Partial<PdfParserOptions> = {}): PdfParser {
  return new PdfParser({
    ...options,
    forceVisionMode: false,
    targetPixels: PDF_RASTER_DEFAULT_TARGET_PIXELS,
    maxRetries: 5,
    tpmLimitPerWorker: 50000, // 较高的token限制
  });
}

/**
 * **功能 (What):** 创建视觉优先的PDF解析器（适合扫描件）
 * **输入 (Input / @param):**
 * @param textGeneration - 非 Agent 文本生成端口
 * @param visionModelId - 视觉模型ID
 * @param options - 额外配置选项
 * **输出 (Output / @returns):** 视觉优化的PDF解析器实例
 * **副作用 (Side-effects):** 创建新的解析器实例
 */
export function createVisionPdfParser(
  textGeneration: TextGenerationPort,
  visionModelId: string,
  options: Partial<PdfParserOptions> = {}
): PdfParser {
  return new PdfParser({
    ...options,
    textGeneration,
    visionModelId,
    forceVisionMode: true, // 强制使用视觉模式
    targetPixels: PDF_RASTER_DEFAULT_TARGET_PIXELS,
    maxRetries: 5,
  });
}

/**
 * **功能 (What):** 创建高性能批处理PDF解析器
 * **输入 (Input / @param):**
 * @param options - 基础配置选项
 * **输出 (Output / @returns):** 高性能PDF解析器实例
 * **副作用 (Side-effects):** 创建新的解析器实例
 */
export function createBatchPdfParser(options: Partial<PdfParserOptions> = {}): PdfParser {
  return new PdfParser({
    ...options,
    forceVisionMode: false,
    targetPixels: PDF_RASTER_DEFAULT_TARGET_PIXELS, // 平衡质量和内存峰值
    maxRetries: 3,
    tpmLimitPerWorker: 100000, // 高throughput配置
  });
}
