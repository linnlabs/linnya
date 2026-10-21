import { createHash } from 'node:crypto';
import type { WebPageResource } from '../../definitions/webDocument';
import { WebFailureError, getWebFailureKind } from '../../shared/webFailure';
import { createBoundaryToken, wrapUntrustedWebContent } from '../../shared/observation/untrustedWebContent';

const MAX_RECOVERY_RESOURCES = 8;
const MAX_RECOVERY_RESOURCE_CHARS = 6_000;

/** 仅合并这次读取实际见到的链接，不发请求，也不登记链接目标的 Evidence。 */
export function mergeWebReadRecoveryResources(
  ...captures: (readonly WebPageResource[] | undefined)[]
): WebPageResource[] {
  const resources = new Map<string, WebPageResource>();
  let characters = 0;
  for (const capture of captures) {
    for (const resource of capture ?? []) {
      if (resources.has(resource.url)) continue;
      const label = resource.label?.slice(0, 200);
      const size = resource.url.length + (label?.length ?? 0) + 20;
      // 错误不走正文分页；过长的单个 URL 不截断成另一个地址，保留其它可用线索。
      if (characters + size > MAX_RECOVERY_RESOURCE_CHARS) continue;
      resources.set(resource.url, { kind: resource.kind, url: resource.url, ...(label ? { label } : {}) });
      characters += size;
      if (resources.size >= MAX_RECOVERY_RESOURCES) return [...resources.values()];
    }
  }
  return [...resources.values()];
}

export function attachWebReadRecoveryResources<TReason extends string>(
  error: WebFailureError<TReason>,
  resources: readonly WebPageResource[],
): WebFailureError<TReason> {
  // 安全拒绝不附资源。中途 abort 仍保留取得事实，供 ladder 区分总预算超时；
  // 调用者取消时不展示这些事实，不能用线索掩盖取消终态。
  const kind = getWebFailureKind(error);
  if (kind === 'policy_denied' || resources.length === 0) return error;
  return new WebFailureError<TReason>(error.kind, error.message, {
    status: error.status,
    details: {
      ...error.details,
      resources: mergeWebReadRecoveryResources(resources, error.details?.resources),
    },
    cause: error,
  });
}

export function formatWebReadRecoveryResources(error: unknown): string {
  if (!(error instanceof WebFailureError) || !error.details?.resources?.length) return '';
  if (getWebFailureKind(error) === 'aborted') return '';
  const resources = mergeWebReadRecoveryResources(error.details.resources);
  const body = resources.map(resource =>
    `- ${resource.kind}: ${resource.label ? `${resource.label} ` : ''}${resource.url}`).join('\n');
  const hash = createHash('sha256').update(body).digest('hex');
  return [
    '本次读取未取得合格正文，但已从页面发现以下资源链接；链接目标尚未读取或保存，不能作为目标内容的引用。可按需另行调用 web_read，仍须通过 URL/DNS 准入。',
    ...wrapUntrustedWebContent({ token: createBoundaryToken(hash), body }),
  ].join('\n');
}
