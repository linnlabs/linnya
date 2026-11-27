import { isRecord } from '@linnya/foundation';

export interface StoredModelReferences {
  readonly id: string | undefined;
  readonly inferenceEndpointId: string | undefined;
  readonly customProviderName: string | undefined;
  readonly displayName: string | undefined;
}

/**
 * 身份字段只要求去掉空白后非空，返回原值、不做 trim：
 * 规范化后的 ID 会对不上连接、Provider 归属与选择器偏好里保存的原 ID。
 */
function readStoredIdentity(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/** 分组名与显示名只用于归属判断和列出，按已准入模型的同一规则去掉首尾空白。 */
function readStoredLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * 停用（启动时未通过准入）的原始条目仍可能被连接、Provider 归属或选择器偏好引用，
 * 也要在模型设置里列出来让用户删除或修复。这里只读取身份、分组名和显示名，不解释或修复条目的其余内容。
 */
export function readStoredModelReferences(value: unknown): StoredModelReferences {
  if (!isRecord(value)) {
    return {
      id: undefined,
      inferenceEndpointId: undefined,
      customProviderName: undefined,
      displayName: undefined,
    };
  }
  return {
    id: readStoredIdentity(value.id),
    inferenceEndpointId: readStoredIdentity(value.inference_endpoint_id),
    customProviderName: readStoredLabel(value.custom_provider_name),
    displayName: readStoredLabel(value.display_name) ?? readStoredLabel(value.model_name),
  };
}
