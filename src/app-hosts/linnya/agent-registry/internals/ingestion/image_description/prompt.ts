import { IMAGE_DESCRIPTION_PROMPT_CONTENT } from 'src/features/parsers/definitions/imageDescriptionPrompt';
/**
 * @file src/app-hosts/linnya/agent-registry/internals/ingestion/image_description/prompt.ts
 * @description 图像描述Host Prompt 注册视图（正文真源归通用 parser owner）
 */

import type { PromptTemplate } from '../../../prompt.types';
import { PromptKeys, PromptType } from '../../../prompt.types';

/**
 * 图像描述提示词模板
 * 用于生成图像的详细描述
 */
export const IMAGE_DESCRIPTION_PROMPT: PromptTemplate = {
  id: PromptKeys.IMAGE_DESCRIPTION,
  type: PromptType.INTERNAL,
  content: IMAGE_DESCRIPTION_PROMPT_CONTENT,
  variables: [],
  description: '图像描述生成提示词模板',
};

export default IMAGE_DESCRIPTION_PROMPT;


