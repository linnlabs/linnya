/**
 * @file src/parsers/pdfParser/types.ts
 *
 * **功能 (What):** PDF解析器核心类型定义
 * **输入 (Input):** 无
 * **输出 (Output):** TypeScript类型定义
 * **副作用 (Side-effects):** 无副作用，纯类型定义
 */

import type { TextGenerationPort } from 'src/domains/model-inference';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import { ParsedBlock } from '../types';

/**
 * **功能 (What):** PDF布局复杂度评估结果
 * **输入 (Input):** 包含栏数、策略选择等信息
 * **输出 (Output):** 用于决定处理策略
 * **副作用 (Side-effects):** 无副作用，纯数据结构
 */
export interface LayoutComplexity {
  columnCount: number; // 检测到的栏数
  xPeaks: number[]; // x坐标分布峰值
  confidence: number; // 检测置信度
  strategy: 'direct' | 'geometric' | 'vision'; // 推荐处理策略
  textDensity: number; // 文本密度（字符数/页）
}

/**
 * **功能 (What):** 文本项目（从PDF.js提取）
 * **输入 (Input):** 包含文本内容和坐标信息
 * **输出 (Output):** 用于布局分析和排序
 * **副作用 (Side-effects):** 无副作用，纯数据结构
 */
export interface TextItem {
  str: string; // 文本内容
  transform: number[]; // 变换矩阵 [a, b, c, d, x, y]
  width: number; // 文本宽度
  height: number; // 文本高度
  page?: number; // 页码
}

/**
 * **功能 (What):** 速率限制跟踪器条目接口
 * **输入 (Input):** 时间戳和token数量
 * **输出 (Output):** 用于跟踪API调用速率
 * **副作用 (Side-effects):** 无副作用，纯数据结构
 */
export interface RateLimitEntry {
  timestamp: number;
  tokens: number;
}

/**
 * **功能 (What):** PDF解析器选项接口
 * **输入 (Input):** 包含文本生成端口、视觉模型ID等配置
 * **输出 (Output):** 用于配置PDF解析器行为
 * **副作用 (Side-effects):** 无副作用，纯配置类型
 */
export interface PdfParserOptions {
  textGeneration?: TextGenerationPort; // 非 Agent 文本生成端口（仅视觉路径需要）
  documentOcr?: DocumentOcrPort; // 专用文档 OCR 端口（仅视觉路径需要）
  filename?: string; // 原始文件名，用于解析阶段错误提示
  visionModelId?: string; // 视觉模型ID（可选）
  resolveModelByCapability?: (capability: string) => string | undefined; // 按能力解析默认模型（可选）
  targetPixels?: number; // 目标图像像素数
  tpmLimitPerWorker?: number; // Token速率限制
  maxRetries?: number; // 重试次数
  useSystemTools?: boolean; // 是否使用系统工具作为降级
  forceVisionMode?: boolean; // 强制使用视觉模式
}

/**
 * **功能 (What):** 处理策略结果
 * **输入 (Input):** 处理成功标志、数据块或错误信息
 * **输出 (Output):** 用于传递处理结果
 * **副作用 (Side-effects):** 无副作用，纯数据结构
 */
export interface StrategyResult {
  success: boolean;
  blocks?: ParsedBlock[];
  error?: string;
}

/**
 * **功能 (What):** PDF页面处理上下文
 * **输入 (Input):** 页面相关的处理信息
 * **输出 (Output):** 用于在处理过程中传递状态
 * **副作用 (Side-effects):** 无副作用，纯数据结构
 */
export interface PageProcessingContext {
  docId: string;
  pageNum: number;
  totalPages: number;
  updater?: (progress: number, message: string) => void;
}
