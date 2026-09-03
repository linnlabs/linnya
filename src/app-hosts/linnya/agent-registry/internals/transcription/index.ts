/**
 * @file src/app-hosts/linnya/agent-registry/internals/transcription/index.ts
 *
 * @description
 * 内部任务：音频转录（ASR）
 *
 * 目标：
 * - 把“默认用哪个转录模型”的策略写清楚（目录内聚）；
 * - 调用方只读策略/解析结果，不再散落 env 与默认值。
 */

import type { AgentConfiguration } from '../../types';

/**
 * 模型选择策略（声明式）：
 * - 默认按能力选择：audio_transcription
 * - 若调用方显式传入 modelId（通常来自用户在前端选择的转录模型），应优先使用调用方
 */
export const TRANSCRIPTION_MODEL_POLICY: NonNullable<AgentConfiguration['modelPolicy']> = {
  kind: 'by_capability',
  capability: 'audio_transcription',
};


