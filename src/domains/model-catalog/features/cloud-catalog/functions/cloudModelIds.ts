/**
 * @file src/domains/model-catalog/features/cloud-catalog/functions/cloudModelIds.ts
 *
 * @description
 * 云端模型的本地注册 ID 规则与常用模型常量。
 *
 * 设计原因：
 * - Cloud Worker 暴露的是“模型名”（如 `deepseek-chat`）；
 * - 客户端注册到本地 Model Catalog 时，会统一加上 `cloud-` 前缀作为本地唯一 ID；
 * - 若业务代码在各处手写 `cloud-xxx` / `default-xxx`，模型切换时极易漂移。
 */

export const CLOUD_MODEL_ID_PREFIX = 'cloud-' as const;

/** 当前默认云端非思考聊天模型名（来自 Cloud Worker /v1/models 的 id 字段） */
export const CLOUD_DEEPSEEK_CHAT_MODEL_NAME = 'deepseek-chat' as const;

/** 当前默认云端思考模型名 */
export const CLOUD_DEEPSEEK_REASONER_MODEL_NAME = 'deepseek-reasoner' as const;

export function toCloudModelId(modelName: string): string {
  return `${CLOUD_MODEL_ID_PREFIX}${modelName}`;
}

export const CLOUD_DEEPSEEK_CHAT_MODEL_ID = toCloudModelId(CLOUD_DEEPSEEK_CHAT_MODEL_NAME);
export const CLOUD_DEEPSEEK_REASONER_MODEL_ID = toCloudModelId(CLOUD_DEEPSEEK_REASONER_MODEL_NAME);
