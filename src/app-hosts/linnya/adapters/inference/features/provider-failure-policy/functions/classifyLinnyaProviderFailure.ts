import type {
  AiSdkFailureProjection,
  AiSdkProviderFailureCandidate,
  AiSdkProviderFailureClassifier,
} from '@linnlabs/linnkit-provider-ai-sdk';

const LINNYA_CLOUD_QUOTA_BODY_MARKERS = [
  '额度上限',
  '已达上限',
  '免费期已结束',
  '该模型暂不可用',
] as const;

function isQuotaDiscriminator(candidate: AiSdkProviderFailureCandidate): boolean {
  const discriminator = `${candidate.type ?? ''} ${candidate.code ?? ''} ${candidate.reason ?? ''}`;
  return /(insufficient[_ -]?quota)/u.test(discriminator);
}

function readHttpProviderErrorType(body: string | undefined): string | undefined {
  if (body === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // 非 JSON 的上游拒绝仍交回通用 HTTP 分类，不从错误文案推测产品语义。
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) return undefined;
  const error = parsed.error;
  if (typeof error !== 'object' || error === null || !('type' in error)) return undefined;
  return typeof error.type === 'string' ? error.type.toLowerCase() : undefined;
}

function isOpenCodeSessionRequired(candidate: AiSdkProviderFailureCandidate): boolean {
  if (candidate.status_code !== undefined && candidate.status_code !== 400) return false;
  const type = candidate.kind === 'api_call'
    ? readHttpProviderErrorType(candidate.response_body)
    : candidate.type?.toLowerCase();
  return type === 'missingsessionid';
}

/** 产品错误码只在 Host 边界产生，通用 AI SDK adapter 不认识套餐或客户端接入要求。 */
export function classifyLinnyaProviderFailure(
  candidate: AiSdkProviderFailureCandidate
): AiSdkFailureProjection | undefined {
  if (isOpenCodeSessionRequired(candidate)) {
    return { kind: 'provider', code: 'opencode_session_required', retryable: false };
  }
  const body = candidate.response_body?.toLowerCase() ?? '';
  if (
    LINNYA_CLOUD_QUOTA_BODY_MARKERS.some(marker => body.includes(marker)) ||
    isQuotaDiscriminator(candidate)
  ) {
    return { kind: 'provider', code: 'cloud_quota_exhausted', retryable: false };
  }
  return undefined;
}

export const linnyaProviderFailureClassifier: AiSdkProviderFailureClassifier = {
  classify: classifyLinnyaProviderFailure,
};
