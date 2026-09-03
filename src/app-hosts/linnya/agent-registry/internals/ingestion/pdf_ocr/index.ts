/**
 * @file src/app-hosts/linnya/agent-registry/internals/ingestion/pdf_ocr/index.ts
 *
 * @description
 * 内部任务：PDF OCR（视觉识别）
 *
 * 约束（与你的“统一管理”要求一致）：
 * - prompt 与模型选择策略必须在同目录写清楚；
 * - 调用点应优先从本文件导入，而不是直接引用 prompt.ts。
 */

import type { AgentConfiguration } from '../../../types';
import { PDF_OCR_PROMPT } from './prompt';

/**
 * PDF OCR 默认模型 capability。
 *
 * 为什么放在策略模块里：
 * - 它描述的是“PDF OCR 这个业务角色需要什么默认模型”；
 * - 具体模型 ID 仍由 Model Catalog 默认资产上的能力标签决定。
 */
export const PDF_OCR_DEFAULT_CAPABILITY = 'pdf_ocr_default';

/**
 * PDF OCR 默认模型的兼容兜底 ID。
 *
 * 注意：这不是默认模型真源。真源是 `default_models.json` 中带
 * `pdf_ocr_default` capability 的模型；这里只用于注册表缺标签或尚未加载时保持旧行为。
 */
export const PDF_OCR_DEFAULT_FALLBACK_MODEL_ID = 'PaddlePaddle/PaddleOCR-VL-1.5';

/**
 * 模型选择策略（声明式）：
 * - PDF OCR 必须使用“知识库的 PDF OCR 模型”（kb.pdfOcrModelId）；
 * - 调用方（ParsingHandler / PDF 视觉解析器）负责把 visionModelId 传入 TextGenerationPort。
 */
export const PDF_OCR_MODEL_POLICY: NonNullable<AgentConfiguration['modelPolicy']> = {
  kind: 'kb_pdf_ocr',
  defaultCapability: PDF_OCR_DEFAULT_CAPABILITY,
};

export const PDF_OCR_CONTEXT_POLICY: NonNullable<AgentConfiguration['contextPolicy']> = {
  profileId: 'agent',
  toolHistory: {
    strategy: 'per-pair',
    keepLatestToolPairs: 0,
    maxInteractionGroups: 4,
    overflowStrategy: 'fail-fast',
  },
};

export { PDF_OCR_PROMPT };
export default PDF_OCR_PROMPT;
