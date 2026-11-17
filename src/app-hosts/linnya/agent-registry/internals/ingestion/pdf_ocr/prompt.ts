import { PDF_OCR_PROMPT_CONTENT } from 'src/features/parsers/definitions/pdfOcrPrompt';
/**
 * @file src/app-hosts/linnya/agent-registry/internals/ingestion/pdf_ocr/prompt.ts
 * @description PDF OCR Host Prompt 注册视图（正文真源归通用 parser owner）
 */

import type { PromptTemplate } from '../../../prompt.types';
import { PromptKeys, PromptType } from '../../../prompt.types';

/**
 * PDF OCR 提示词模板
 * 用于从 PDF 图像中提取文本
 */
export const PDF_OCR_PROMPT: PromptTemplate = {
  id: PromptKeys.PDF_OCR,
  type: PromptType.INTERNAL,
  content: PDF_OCR_PROMPT_CONTENT,
  variables: [],
  description: 'PDF OCR 文本提取提示词模板',
};

export default PDF_OCR_PROMPT;


