/**
 * @file src/shared/utils/tokenUtils.ts
 * 
 * **功能 (What):** 通用的Token计算工具函数
 * **输入 (Input):** 文本内容、图像尺寸等
 * **输出 (Output):** 预估的token数量
 * **副作用 (Side-effects):** 无副作用，纯函数工具集
 */

/**
 * **功能 (What):** 计算图像的token成本（用于OpenAI Vision API）
 * **输入 (Input / @param):** 
 * @param width - 图像宽度
 * @param height - 图像高度
 * @param detail - 细节级别（默认为"high"）
 * **输出 (Output / @returns):** 预估的token数量
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 * 
 * 注意：此函数基于OpenAI官方文档，但我们实际图片已限制为1536px长边
 */
export function calculateVisionTokens(
  width: number, 
  height: number, 
  detail: string = "high"
): number {
  if (detail === "low") {
    return 85;
  }

  // 高细节模式 - 基于OpenAI官方计算规则
  // 1. 将图像缩放到最大2048x2048的正方形内（OpenAI API规则）
  if (Math.max(width, height) > 2048) {
    const scaleFactor = 2048 / Math.max(width, height);
    width = Math.floor(width * scaleFactor);
    height = Math.floor(height * scaleFactor);
  }

  // 2. 将最短边缩放到768px（OpenAI API规则）
  if (Math.min(width, height) > 768) {
    const scaleFactor = 768 / Math.min(width, height);
    width = Math.floor(width * scaleFactor);
    height = Math.floor(height * scaleFactor);
  }

  // 3. 计算需要多少个512px的图块
  const numTilesWidth = Math.ceil(width / 512);
  const numTilesHeight = Math.ceil(height / 512);
  const totalTiles = numTilesWidth * numTilesHeight;

  // 4. 计算总token
  const tokenCost = totalTiles * 170 + 85;
  return tokenCost;
}

/**
 * **功能 (What):** 基于我们实际图片尺寸计算token成本
 * **输入 (Input / @param):** 
 * @param targetPixels - 目标像素数（长边），默认1536
 * @param detail - 细节级别（默认为"high"）
 * **输出 (Output / @returns):** 预估的token数量
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 */
export function calculateVisionTokensForOurImages(
  targetPixels: number,
  detail: string = "high"
): number {
  // 🔥 基于我们实际的图片尺寸控制逻辑
  // 假设最常见的A4比例：长边1536，短边约1087（1536 * 595/842）
  const longSide = targetPixels;
  const shortSide = Math.round(targetPixels * 595 / 842); // A4比例
  
  return calculateVisionTokens(longSide, shortSide, detail);
}

/**
 * **功能 (What):** 估算文本的token数量（简化版）
 * **输入 (Input / @param):** 
 * @param text - 要估算的文本
 * **输出 (Output / @returns):** 预估的token数量
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 */
export function estimateTextTokens(text: string): number {
  if (!text) {
    return 0;
  }

  // 简单的中英文字符统计估算
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const totalChars = text.length;
  const englishChars = totalChars - chineseChars;

  // 估算token数
  const chineseTokens = chineseChars / 1.5;
  const englishTokens = englishChars / 4.0;

  return Math.floor(chineseTokens + englishTokens);
}

/**
 * **功能 (What):** 估算文本的token数量（精确版）
 * **输入 (Input / @param):** 
 * @param text - 要估算的文本
 * **输出 (Output / @returns):** 预估的token数量
 * **副作用 (Side-effects):** 无副作用，纯计算函数
 */
export function estimateTextTokensAccurate(text: string): number {
  if (!text) return 0;

  // 中文字符匹配
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  
  // 英文单词匹配  
  const englishWords = text.split(/\s+/).filter(word => word.match(/[a-zA-Z]/)).length;
  
  // 其他字符（标点、数字、符号等）
  const otherChars = text.length - chineseChars;
  
  // Token计算：中文1.5倍，英文单词1倍，其他字符0.5倍
  return Math.ceil(chineseChars * 1.5 + englishWords + otherChars * 0.5);
}
