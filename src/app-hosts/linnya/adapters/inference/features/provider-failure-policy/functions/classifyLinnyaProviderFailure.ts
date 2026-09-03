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

/** Linnya 产品错误码只在 Host 边界产生，通用 AI SDK adapter 不认识 Cloud 文案。 */
export function classifyLinnyaProviderFailure(
  candidate: AiSdkProviderFailureCandidate
): AiSdkFailureProjection | undefined {
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
