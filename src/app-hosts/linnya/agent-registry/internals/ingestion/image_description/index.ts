/**
 * @file src/app-hosts/linnya/agent-registry/internals/ingestion/image_description/index.ts
 *
 * @description
 * 内部任务：Image Description（图像描述）
 *
 * 约束（与你的“统一管理”要求一致）：
 * - prompt 与模型选择策略必须在同目录写清楚；
 * - 调用点应优先从本文件导入，而不是直接引用 prompt.ts。
 */

import type { AgentConfiguration } from '../../../types';
import { IMAGE_DESCRIPTION_PROMPT } from './prompt';

/**
 * 模型选择策略（声明式）：
 * - 图像描述必须使用“知识库的图片视觉模型”（kb.imageVisionModelId）；
 * - 调用方（ParsingHandler / ImageParser）负责把 visionModelId 传入 TextGenerationPort。
 */
export const IMAGE_DESCRIPTION_MODEL_POLICY: NonNullable<AgentConfiguration['modelPolicy']> = {
  kind: 'kb_image_vision',
};

export const IMAGE_DESCRIPTION_CONTEXT_POLICY: NonNullable<AgentConfiguration['contextPolicy']> = {
  profileId: 'agent',
  toolHistory: {
    strategy: 'per-pair',
    keepLatestToolPairs: 0,
    maxInteractionGroups: 4,
    overflowStrategy: 'fail-fast',
  },
};

export { IMAGE_DESCRIPTION_PROMPT };
export default IMAGE_DESCRIPTION_PROMPT;
