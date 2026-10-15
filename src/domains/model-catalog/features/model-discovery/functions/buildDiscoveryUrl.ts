import {
  normalizeCustomApiBaseUrl,
  type CustomApiFormat,
} from '@app/schemas/custom-api-onboarding';
import { ModelDiscoveryError } from '../definitions/modelDiscoveryError';

/** 与推理共用同一 base path；显式网关路径不能偷偷加上第二层 /v1。 */
export function buildDiscoveryUrl(
  baseUrl: string,
  apiFormat: CustomApiFormat,
  afterId?: string
): string {
  const normalized = normalizeCustomApiBaseUrl(apiFormat, baseUrl);
  if (!normalized)
    throw new ModelDiscoveryError('model_discovery.invalid_request', 'API 地址无效', 400);
  const url = new URL(normalized);
  if (!url.pathname.endsWith('/models')) url.pathname += '/models';
  if (apiFormat === 'anthropic_compatible') {
    url.searchParams.set('limit', '1000');
    if (afterId !== undefined) url.searchParams.set('after_id', afterId);
  }
  return url.toString();
}
