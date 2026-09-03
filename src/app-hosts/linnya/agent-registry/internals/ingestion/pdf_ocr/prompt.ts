/**
 * @file src/app-hosts/linnya/agent-registry/internals/ingestion/pdf_ocr/prompt.ts
 * @description PDF OCR 内部提示词（内聚到 ingestion 目录）
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
  content: `从以下图像中提取所有可见的文本内容，按照原始阅读顺序输出。
以原始格式保留文本布局，包括段落、列表和表格结构。
对于多栏布局，按从左到右、从上到下的顺序提取文本。
对于表格，使用标准的Markdown表格语法。
如果有任何图表或图像，简要描述它们的内容和位置。
对于公式，使用标准的Latex语法。
只返回你能确定的文本，如果某些部分无法辨认，用 [?] 标记。
禁止生成html标签，只返回Markdown格式。`,
  variables: [],
  description: 'PDF OCR 文本提取提示词模板',
};

export default PDF_OCR_PROMPT;


