import { isRecord } from '@linnya/foundation';

export interface StoredModelReferences {
  readonly id: string | undefined;
  readonly inferenceEndpointId: string | undefined;
}

/**
 * 身份字段只要求去掉空白后非空，返回原值、不做 trim：
 * 规范化后的 ID 会对不上连接、Provider 归属与选择器偏好里保存的原 ID。
 */
function readStoredIdentity(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * 停用（启动时未通过准入）的原始条目仍可能被连接、Provider 归属或选择器偏好引用。
 * 这里只读取这两个身份字段，不解释或修复条目的其余内容。
 */
export function readStoredModelReferences(value: unknown): StoredModelReferences {
  if (!isRecord(value)) return { id: undefined, inferenceEndpointId: undefined };
  return {
    id: readStoredIdentity(value.id),
    inferenceEndpointId: readStoredIdentity(value.inference_endpoint_id),
  };
}
