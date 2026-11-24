import { isRecord } from '@linnya/foundation';

export interface StoredModelReferences {
  readonly id: string | undefined;
  readonly inferenceEndpointId: string | undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * 未通过准入的原始条目仍可能被连接、Provider 归属或选择器偏好引用。
 * 这里只读取这两个身份字段，不解释或修复条目的其余内容。
 */
export function readStoredModelReferences(value: unknown): StoredModelReferences {
  if (!isRecord(value)) return { id: undefined, inferenceEndpointId: undefined };
  return {
    id: readNonEmptyString(value.id),
    inferenceEndpointId: readNonEmptyString(value.inference_endpoint_id),
  };
}
