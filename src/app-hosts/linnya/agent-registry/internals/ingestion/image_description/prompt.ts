/**
 * @file src/app-hosts/linnya/agent-registry/internals/ingestion/image_description/prompt.ts
 * @description 图像描述内部提示词（内聚到 ingestion 目录）
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
  content: `请详细描述此图像的内容。包括:
1. 主体对象和场景
2. 颜色、形状和布局
3. 可见的文字或标签
4. 图像可能传达的主要信息或目的
描述应该清晰、全面且客观。`,
  variables: [],
  description: '图像描述生成提示词模板',
};

export default IMAGE_DESCRIPTION_PROMPT;


