import { createHash } from 'node:crypto';

/**
 * 为模型可见的不可信来源正文生成动态边界 token。
 *
 * token 必须包含正文事实：如果来源正文试图伪造结束标记，它无法预先知道由完整正文生成的真实 token。
 * 该函数只提供安全格式原语，不理解 Web、Knowledge、Evidence 或 Citation 的领域身份。
 */
export function createUntrustedContentBoundaryToken(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 16);
}

/**
 * 包裹一段不可信正文。可信 ref、来源锚点、权限与预算状态必须由调用领域留在边界外。
 */
export function wrapUntrustedContentBoundary(params: {
  readonly namespace: string;
  readonly token: string;
  readonly body: string;
}): string[] {
  return [
    `<<<BEGIN_UNTRUSTED_${params.namespace}_${params.token}>>>`,
    params.body,
    `<<<END_UNTRUSTED_${params.namespace}_${params.token}>>>`,
  ];
}
